import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Account,
  Contract,
  Keypair,
  Transaction,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import {
  STELLAR_CONFIG,
  DEFAULT_MAX_FEE,
  TRANSACTION_TIMEOUT_SECONDS,
} from '../stellar.constants';
import type { StellarConfig } from '../stellar.config';

/** Reads a non-negative integer from the environment, with a default. */
function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Outcome of submitting a transaction to the network. */
export interface SubmitResult {
  /** Transaction hash — the canonical on-chain identifier, always present. */
  hash: string;
  /** Whether the transaction was included in a ledger and succeeded. */
  confirmed: boolean;
  /** Ledger sequence the transaction landed in, once confirmed. */
  ledger?: number;
  /** Decoded contract return value, when the invocation produced one. */
  returnValue?: unknown;
  /** Failure detail, when `confirmed` is false. */
  error?: string;
}

/** A transaction the backend built but cannot sign itself. */
export interface UnsignedTransaction {
  /** Base64 transaction envelope for a wallet to sign. */
  xdr: string;
  /** Network the XDR must be signed against. */
  networkPassphrase: string;
  /** Hash the transaction will have once signed and submitted unchanged. */
  hash: string;
}

/**
 * Thin, typed wrapper around the Soroban JSON-RPC server.
 *
 * Everything that talks to the network goes through here, which keeps retry
 * behaviour, fee policy and error translation in one place rather than spread
 * across every service that happens to invoke a contract.
 */
@Injectable()
export class StellarRpcService {
  private readonly logger = new Logger(StellarRpcService.name);
  private readonly server: rpc.Server;

  constructor(@Inject(STELLAR_CONFIG) private readonly config: StellarConfig) {
    this.server = new rpc.Server(this.config.rpcUrl, {
      allowHttp: this.config.rpcUrl.startsWith('http://'),
    });
  }

  /** The underlying RPC server, for the rare call this wrapper does not cover. */
  get rpcServer(): rpc.Server {
    return this.server;
  }

  /** Loads an account so its sequence number can be used to build a transaction. */
  async loadAccount(publicKey: string): Promise<Account> {
    try {
      return await this.server.getAccount(publicKey);
    } catch (error) {
      throw new ServiceUnavailableException(
        `Could not load Stellar account ${publicKey}: ${(error as Error).message}. ` +
          'On a test network the account may simply not be funded yet.',
      );
    }
  }

  /**
   * Builds a contract invocation and runs it through simulation so that the
   * resulting transaction carries the footprint, resource fees and
   * authorisation entries Soroban requires.
   */
  async buildInvocation(
    sourcePublicKey: string,
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    timeoutSeconds: number = TRANSACTION_TIMEOUT_SECONDS,
  ): Promise<Transaction> {
    const source = await this.loadAccount(sourcePublicKey);
    const contract = new Contract(contractId);

    const transaction = new TransactionBuilder(source, {
      fee: DEFAULT_MAX_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(timeoutSeconds)
      .build();

    try {
      return await this.server.prepareTransaction(transaction);
    } catch (error) {
      throw new ServiceUnavailableException(
        `Simulation of ${method} on ${contractId} failed: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Simulates a read-only contract call and returns its decoded result without
   * submitting anything. Used for balance reads, which must never cost a fee.
   */
  async readContract(
    sourcePublicKey: string,
    contractId: string,
    method: string,
    args: xdr.ScVal[],
  ): Promise<unknown> {
    const source = new Account(sourcePublicKey, '0');
    const contract = new Contract(contractId);

    const transaction = new TransactionBuilder(source, {
      fee: DEFAULT_MAX_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(TRANSACTION_TIMEOUT_SECONDS)
      .build();

    const simulation = await this.server.simulateTransaction(transaction);

    if (rpc.Api.isSimulationError(simulation)) {
      throw new ServiceUnavailableException(
        `Read of ${method} on ${contractId} failed: ${simulation.error}`,
      );
    }

    if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
      throw new ServiceUnavailableException(
        `Read of ${method} on ${contractId} returned no value`,
      );
    }

    return scValToNative(simulation.result.retval);
  }

  /**
   * Serialises a prepared transaction for a wallet to sign.
   *
   * The hash is computed now so the caller can record it before the player
   * signs; as long as the wallet only adds a signature, the submitted
   * transaction keeps this hash.
   */
  toUnsigned(transaction: Transaction): UnsignedTransaction {
    return {
      xdr: transaction.toXDR(),
      networkPassphrase: this.config.networkPassphrase,
      hash: this.hashHex(transaction),
    };
  }

  /** Rebuilds a transaction from XDR a wallet signed and returned. */
  fromXdr(envelopeXdr: string): Transaction {
    return new Transaction(envelopeXdr, this.config.networkPassphrase);
  }

  /**
   * Signs a prepared transaction and submits it, then waits for the network to
   * include it in a ledger.
   *
   * The wait matters: Soroban's `sendTransaction` returns as soon as the
   * transaction is queued, and a queued transaction can still fail. Treating
   * `PENDING` as success is how a wager ends up marked settled while the funds
   * never moved.
   */
  async signAndSubmit(
    transaction: Transaction,
    signers: Keypair[],
  ): Promise<SubmitResult> {
    for (const signer of signers) {
      transaction.sign(signer);
    }

    return this.submit(transaction);
  }

  /** Submits an already-signed transaction and waits for confirmation. */
  async submit(transaction: Transaction): Promise<SubmitResult> {
    const hash = this.hashHex(transaction);

    const maxRetries = envInt('STELLAR_TRY_AGAIN_MAX_ATTEMPTS', 5);
    const baseDelayMs = envInt('STELLAR_TRY_AGAIN_BASE_DELAY_MS', 500);

    let sent: rpc.Api.SendTransactionResponse;
    for (let attempt = 0; ; attempt++) {
      try {
        sent = await this.server.sendTransaction(transaction);
      } catch (error) {
        return {
          hash,
          confirmed: false,
          error: `Submission failed: ${(error as Error).message}`,
        };
      }

      // TRY_AGAIN_LATER means the queue is full and the transaction was NOT
      // accepted, so polling for it is pointless: back off and resubmit.
      if (sent.status !== 'TRY_AGAIN_LATER') break;

      if (attempt >= maxRetries) {
        return {
          hash,
          confirmed: false,
          error: `Network queue still full after ${attempt + 1} submissions (TRY_AGAIN_LATER)`,
        };
      }

      await this.sleep(baseDelayMs * 2 ** attempt);
    }

    if (sent.status === 'ERROR' || sent.status === 'DUPLICATE') {
      // DUPLICATE means this exact transaction is already in flight, which for
      // our idempotent flows is not an error — fall through to polling.
      if (sent.status === 'ERROR') {
        return {
          hash: sent.hash,
          confirmed: false,
          error: `Network rejected the transaction: ${JSON.stringify(sent.errorResult ?? {})}`,
        };
      }
    }

    return this.waitForConfirmation(sent.hash);
  }

  /**
   * Polls until the transaction reaches a terminal state.
   *
   * A `NOT_FOUND` result after the poll budget is exhausted is reported as
   * unconfirmed rather than failed: the transaction may still land, so the
   * caller must reconcile it later instead of paying out twice.
   */
  async waitForConfirmation(hash: string): Promise<SubmitResult> {
    try {
      const result = await this.server.pollTransaction(hash, {
        attempts: envInt('STELLAR_POLL_ATTEMPTS', 15),
        sleepStrategy:
          process.env.STELLAR_POLL_SLEEP_STRATEGY === 'basic'
            ? rpc.BasicSleepStrategy
            : rpc.LinearSleepStrategy,
      });

      if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return {
          hash,
          confirmed: true,
          ledger: result.ledger,
          returnValue: result.returnValue
            ? scValToNative(result.returnValue)
            : undefined,
        };
      }

      if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
        return {
          hash,
          confirmed: false,
          ledger: result.ledger,
          error: `Transaction failed on-chain: ${JSON.stringify(result.resultXdr?.toXDR('base64') ?? '')}`,
        };
      }

      this.logger.warn(
        `Transaction ${hash} was not found after polling; it may still be included. ` +
          'Leaving it for reconciliation rather than assuming failure.',
      );

      return {
        hash,
        confirmed: false,
        error:
          'Transaction not yet visible on the network; awaiting reconciliation',
      };
    } catch (error) {
      return {
        hash,
        confirmed: false,
        error: `Could not confirm transaction: ${(error as Error).message}`,
      };
    }
  }

  /** Looks up a previously submitted transaction, for reconciliation sweeps. */
  async lookupTransaction(hash: string): Promise<SubmitResult> {
    try {
      const result = await this.server.getTransaction(hash);

      if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return {
          hash,
          confirmed: true,
          ledger: result.ledger,
          returnValue: result.returnValue
            ? scValToNative(result.returnValue)
            : undefined,
        };
      }

      return {
        hash,
        confirmed: false,
        error: `Transaction status: ${result.status}`,
      };
    } catch (error) {
      return {
        hash,
        confirmed: false,
        error: `Lookup failed: ${(error as Error).message}`,
      };
    }
  }

  /** Overridable delay, so tests need not wait in real time. */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Hex transaction hash.
   *
   * `Transaction.hash()` returns a `Uint8Array`, which has no radix-aware
   * `toString`; wrapping it in a Buffer is what produces the hex string every
   * explorer and RPC endpoint expects.
   */
  private hashHex(transaction: Transaction): string {
    return Buffer.from(transaction.hash()).toString('hex');
  }

  /** Reports whether the RPC endpoint is reachable and healthy. */
  async isHealthy(): Promise<boolean> {
    try {
      const health = await this.server.getHealth();
      return health.status === 'healthy';
    } catch {
      return false;
    }
  }
}
