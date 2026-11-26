import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Address,
  Operation,
  Transaction,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import { STELLAR_CONFIG } from '../stellar.constants';
import type { StellarConfig } from '../stellar.config';
import {
  StellarRpcService,
  SubmitResult,
  UnsignedTransaction,
} from './stellar-rpc.service';
import type { TransactionSigner } from './transaction-signer';
import { Stroops, toBigInt } from '../amount.util';

/** Lifecycle of a pot, mirroring the contract's `PotStatus` enum. */
export enum PotStatus {
  OPEN = 'Open',
  FUNDED = 'Funded',
  RESOLVED = 'Resolved',
  REFUNDED = 'Refunded',
}

/** A pot as stored by the escrow contract. */
export interface OnChainPot {
  playerA: string;
  playerB: string;
  stake: Stroops;
  fundedA: boolean;
  fundedB: boolean;
  status: PotStatus;
  /** Ledger after which a player may reclaim their own stake via `claim_refund`. */
  deadlineLedger: number;
}

/**
 * Typed client for the LyricsFlip escrow contract.
 *
 * Every method here maps one-to-one onto a contract function, so the shape of
 * the on-chain API stays visible from TypeScript instead of being buried in
 * ad-hoc ScVal construction at each call site.
 */
@Injectable()
export class EscrowContractService {
  private readonly logger = new Logger(EscrowContractService.name);

  constructor(
    @Inject(STELLAR_CONFIG) private readonly config: StellarConfig,
    private readonly rpc: StellarRpcService,
  ) {}

  /**
   * Creates the pot for a session. Signed by the resolver, because only the
   * backend knows which two players a session belongs to.
   */
  async openPot(
    resolver: TransactionSigner,
    sessionId: string,
    playerAAddress: string,
    playerBAddress: string,
    stake: Stroops,
  ): Promise<SubmitResult> {
    const transaction = await this.rpc.buildInvocation(
      resolver.publicKey(),
      this.config.escrowContractId,
      'open_pot',
      [
        this.sessionIdToScVal(sessionId),
        addressToScVal(playerAAddress),
        addressToScVal(playerBAddress),
        amountToScVal(stake),
      ],
    );

    this.logger.debug(
      `Opening pot for session ${sessionId} with stake ${stake}`,
    );

    return this.rpc.signAndSubmit(transaction, resolver);
  }

  /**
   * Builds the transaction that moves a player's stake into escrow.
   *
   * The contract requires the *player's* authorisation, so this returns a
   * prepared transaction rather than submitting one: in custodial mode the
   * caller signs it with the derived player key, and in non-custodial mode it
   * is serialised to XDR for the player's wallet.
   */
  async buildStake(
    sourcePublicKey: string,
    sessionId: string,
    playerAddress: string,
  ): Promise<Transaction> {
    // The stake is the one transaction a player, not the backend, has to
    // sign, so it gets its own — configurable — timeout: a player who takes
    // longer than the network default to open their wallet should still be
    // able to request a fresh one rather than being stuck (see buildUnsignedStake).
    return this.rpc.buildInvocation(
      sourcePublicKey,
      this.config.escrowContractId,
      'stake',
      [this.sessionIdToScVal(sessionId), addressToScVal(playerAddress)],
      this.config.stakeTxTimeoutSeconds,
    );
  }

  /** Builds a stake transaction and serialises it for a wallet to sign. */
  async buildUnsignedStake(
    sessionId: string,
    playerAddress: string,
  ): Promise<UnsignedTransaction> {
    const transaction = await this.buildStake(
      playerAddress,
      sessionId,
      playerAddress,
    );

    return this.rpc.toUnsigned(transaction);
  }

  /**
   * Builds the transaction that lets a player reclaim their own stake once the
   * pot's `deadline_ledger` has passed.
   *
   * Like `stake`, the contract requires the *player's* authorisation, so this
   * returns a prepared transaction rather than submitting one.
   */
  async buildClaimRefund(
    sourcePublicKey: string,
    sessionId: string,
    playerAddress: string,
  ): Promise<Transaction> {
    return this.rpc.buildInvocation(
      sourcePublicKey,
      this.config.escrowContractId,
      'claim_refund',
      [this.sessionIdToScVal(sessionId), addressToScVal(playerAddress)],
      this.config.stakeTxTimeoutSeconds,
    );
  }

  /** Builds a `claim_refund` transaction and serialises it for a wallet to sign. */
  async buildUnsignedClaimRefund(
    sessionId: string,
    playerAddress: string,
  ): Promise<UnsignedTransaction> {
    const transaction = await this.buildClaimRefund(
      playerAddress,
      sessionId,
      playerAddress,
    );

    return this.rpc.toUnsigned(transaction);
  }

  /**
   * Submits a stake transaction a wallet signed and handed back.
   *
   * The envelope comes from the client, so it is checked before it goes
   * anywhere: it must be exactly one call to `stake(sessionId, playerAddress)`
   * on the escrow contract. Anything else — a payment, a no-op, another
   * player's stake — is rejected here and never reaches the network.
   */
  async submitSignedStake(
    signedXdr: string,
    sessionId: string,
    playerAddress: string,
    expectedHash?: string | null,
  ): Promise<SubmitResult> {
    let transaction: Transaction;
    try {
      transaction = this.rpc.fromXdr(signedXdr);
    } catch {
      throw new BadRequestException('Not a valid signed transaction envelope');
    }

    // Both checks run before anything touches the network: a superseded or
    // foreign envelope must never be submitted.
    if (
      expectedHash &&
      Buffer.from(transaction.hash()).toString('hex') !== expectedHash
    ) {
      throw new BadRequestException(
        'This stake transaction has expired. Request a new one via ' +
          'POST /game-sessions/:id/stake/transaction and sign that instead.',
      );
    }

    this.assertIsStake(transaction, sessionId, playerAddress);

    return this.rpc.submit(transaction);
  }

  /** Releases the pot to the winner. Resolver-signed. */
  async resolve(
    resolver: TransactionSigner,
    sessionId: string,
    winnerAddress: string,
  ): Promise<SubmitResult> {
    const transaction = await this.rpc.buildInvocation(
      resolver.publicKey(),
      this.config.escrowContractId,
      'resolve',
      [this.sessionIdToScVal(sessionId), addressToScVal(winnerAddress)],
    );

    this.logger.debug(
      `Resolving pot for session ${sessionId} in favour of ${winnerAddress}`,
    );

    return this.rpc.signAndSubmit(transaction, resolver);
  }

  /** Returns every staked amount to the player who staked it. Resolver-signed. */
  async refund(
    resolver: TransactionSigner,
    sessionId: string,
  ): Promise<SubmitResult> {
    const transaction = await this.rpc.buildInvocation(
      resolver.publicKey(),
      this.config.escrowContractId,
      'refund',
      [this.sessionIdToScVal(sessionId)],
    );

    this.logger.debug(`Refunding pot for session ${sessionId}`);

    return this.rpc.signAndSubmit(transaction, resolver);
  }

  /**
   * Reads a pot straight from contract storage.
   *
   * This is the source of truth for reconciliation: when a submission's outcome
   * is ambiguous, the pot's status says whether the funds actually moved.
   */
  async getPot(sessionId: string): Promise<OnChainPot | null> {
    try {
      const raw = (await this.rpc.readContract(
        this.config.resolverPublicKey,
        this.config.escrowContractId,
        'get_pot',
        [this.sessionIdToScVal(sessionId)],
      )) as Record<string, unknown>;

      if (!raw) {
        return null;
      }

      return {
        playerA: String(raw.player_a),
        playerB: String(raw.player_b),
        stake: String(raw.stake),
        fundedA: Boolean(raw.funded_a),
        fundedB: Boolean(raw.funded_b),
        status: String(raw.status) as PotStatus,
        deadlineLedger: Number(raw.deadline_ledger ?? 0),
      };
    } catch (error) {
      this.logger.warn(
        `Could not read pot for session ${sessionId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /** Reads a player's balance of the staking token. */
  async getTokenBalance(address: string): Promise<Stroops> {
    const balance = await this.rpc.readContract(
      address,
      this.config.tokenContractId,
      'balance',
      [addressToScVal(address)],
    );

    return decodeBalance(balance);
  }

  /**
   * Throws unless the transaction is the single escrow `stake` call issued for
   * this session and player.
   */
  private assertIsStake(
    transaction: Transaction,
    sessionId: string,
    playerAddress: string,
  ): void {
    const reject = (reason: string): never => {
      throw new BadRequestException(
        `Transaction is not the stake issued for this session: ${reason}`,
      );
    };

    const operations = transaction.operations ?? [];
    if (operations.length !== 1) {
      reject('it must contain exactly one operation');
    }

    const [operation] = operations;
    if (operation.type !== 'invokeHostFunction') {
      reject('it is not a contract invocation');
    }

    const func = (operation as Operation.InvokeHostFunction).func;
    if (func.type !== 'hostFunctionTypeInvokeContract') {
      return reject('it is not a contract invocation');
    }

    const invocation = func.invokeContract;

    const contractId = Address.fromScAddress(
      invocation.contractAddress,
    ).toString();
    if (contractId !== this.config.escrowContractId) {
      reject('it calls the wrong contract');
    }

    if (invocation.functionName.toString() !== 'stake') {
      reject('it does not call stake');
    }

    const [sessionArg, playerArg] = invocation.args;
    if (!sessionArg || !playerArg) {
      reject('it is missing arguments');
    }

    const sessionValue = sessionArg.value();
    if (sessionValue.switch().name !== 'scvString') {
      reject('the session id is not a string');
    }
    if (sessionValue.str().toString() !== sessionId) {
      reject('it is for a different session');
    }

    const playerValue = playerArg.value();
    if (playerValue.switch().name !== 'scvAddress') {
      reject('the player is not an address');
    }
    if (Address.fromScVal(playerValue).toString() !== playerAddress) {
      reject('it is for a different player');
    }
  }

  private sessionIdToScVal(sessionId: string): xdr.ScVal {
    return nativeToScVal(sessionId, { type: 'string' });
  }
}

function addressToScVal(address: string): xdr.ScVal {
  return Address.fromString(address).toScVal();
}

function amountToScVal(amount: Stroops): xdr.ScVal {
  return nativeToScVal(toBigInt(amount), { type: 'i128' });
}

function decodeBalance(balance: unknown): Stroops {
  if (typeof balance === 'bigint') {
    return balance.toString();
  }
  if (typeof balance === 'number') {
    return String(balance);
  }
  if (typeof balance === 'string') {
    return balance;
  }
  throw new ServiceUnavailableException('Unexpected token balance response');
}
