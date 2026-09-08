import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Address,
  Keypair,
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
    resolver: Keypair,
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

    return this.rpc.signAndSubmit(transaction, [resolver]);
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
    return this.rpc.buildInvocation(
      sourcePublicKey,
      this.config.escrowContractId,
      'stake',
      [this.sessionIdToScVal(sessionId), addressToScVal(playerAddress)],
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

  /** Submits a stake transaction a wallet signed and handed back. */
  async submitSignedStake(signedXdr: string): Promise<SubmitResult> {
    return this.rpc.submit(this.rpc.fromXdr(signedXdr));
  }

  /** Releases the pot to the winner. Resolver-signed. */
  async resolve(
    resolver: Keypair,
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

    return this.rpc.signAndSubmit(transaction, [resolver]);
  }

  /** Returns every staked amount to the player who staked it. Resolver-signed. */
  async refund(resolver: Keypair, sessionId: string): Promise<SubmitResult> {
    const transaction = await this.rpc.buildInvocation(
      resolver.publicKey(),
      this.config.escrowContractId,
      'refund',
      [this.sessionIdToScVal(sessionId)],
    );

    this.logger.debug(`Refunding pot for session ${sessionId}`);

    return this.rpc.signAndSubmit(transaction, [resolver]);
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
   * Encodes a session UUID as the contract's `BytesN<16>` session key.
   *
   * A UUID is exactly 16 bytes once the dashes are stripped, so it maps onto
   * the contract key without hashing or truncation.
   */
  private sessionIdToScVal(sessionId: string): xdr.ScVal {
    const hex = sessionId.replace(/-/g, '');

    if (hex.length !== 32 || !/^[0-9a-fA-F]+$/.test(hex)) {
      throw new Error(
        `Session ID "${sessionId}" is not a UUID; the escrow contract keys pots by the 16 UUID bytes`,
      );
    }

    return xdr.ScVal.scvBytes(Buffer.from(hex, 'hex'));
  }
}

/** Encodes a Stellar address (G... or C...) as a contract argument. */
function addressToScVal(address: string): xdr.ScVal {
  return new Address(address).toScVal();
}

/** Encodes a stroop amount as the contract's i128 argument. */
function amountToScVal(amount: Stroops): xdr.ScVal {
  return nativeToScVal(toBigInt(amount), { type: 'i128' });
}

/**
 * Turns the decoded return value of a `balance` call into stroops.
 *
 * `scValToNative` gives a bigint for the contract's i128, but the call is typed
 * `unknown`, and stringifying an unexpected object would quietly yield
 * "[object Object]" as somebody's balance. Narrowing here means a surprising
 * return type fails immediately, with the value that caused it.
 */
function decodeBalance(balance: unknown): Stroops {
  if (balance === null || balance === undefined) {
    return '0';
  }

  if (
    typeof balance === 'bigint' ||
    typeof balance === 'number' ||
    typeof balance === 'string'
  ) {
    return String(balance);
  }

  throw new ServiceUnavailableException(
    `Token contract returned an unreadable balance of type ${typeof balance}`,
  );
}
