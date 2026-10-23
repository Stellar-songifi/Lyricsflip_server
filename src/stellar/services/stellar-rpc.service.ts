import {
  Inject,
  Injectable,
  Logger,
  Optional,
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
import { MetricsService } from '../../metrics/metrics.service';
import { getTracer, SpanStatusCode, type Span } from '../../tracing';

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

  constructor(
    @Inject(STELLAR_CONFIG) private readonly config: StellarConfig,
    @Optional() private readonly metricsService?: MetricsService,
  ) {
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
    const rpcMethod = `buildInvocation:${method}`;
    const start = Date.now();
    try {
      const source = await this.loadAccount(sourcePublicKey);
      const contract = new Contract(contractId);
      const fee = await this.resolveInclusionFee();

      const transaction = new TransactionBuilder(source, {
        fee,
        networkPassphrase: this.config.networkPassphrase,
      })
        .addOperation(contract.call(method, ...args))
        .setTimeout(timeoutSeconds)
        .build();

      let prepared: Transaction;
      try {
        prepared = await this.server.prepareTransaction(transaction);
      } catch (error) {
        throw new ServiceUnavailableException(
          `Simulation of ${method} on ${contractId} failed: ${(error as Error).message}`,
        );
      }
      this.metricsService?.rpcCallDuration.observe(
        { method: rpcMethod, success: 'true' },
        (Date.now() - start) / 1000,
      );
      return prepared;
    } catch (error) {
      this.metricsService?.rpcCallDuration.observe(
        { method: rpcMethod, success: 'false' },
        (Date.now() - start) / 1000,
      );
      this.metricsService?.rpcCallErrors.inc({ method: rpcMethod });
      throw error;
    }
  }

  /** Fee ceiling in stroops, from `STELLAR_MAX_FEE` (default 0.1 XLM). */
  get maxFee(): bigint {
    const raw = process.env.STELLAR_MAX_FEE;
    return raw && /^\d+$/.test(raw) && BigInt(raw) > 0n
      ? BigInt(raw)
      : BigInt(DEFAULT_MAX_FEE);
  }

  /**
   * Inclusion fee per operation: the p90 of recent network fees, capped at
   * {@link maxFee}. Falls back to the cap if fee stats are unavailable.
   */
  async resolveInclusionFee(): Promise<string> {
    const ceiling = this.maxFee;
    try {
      const stats = await this.server.getFeeStats();
      const observed = BigInt(stats.sorobanInclusionFee.p90);
      if (observed <= 0n) return ceiling.toString();
      return (observed < ceiling ? observed : ceiling).toString();
    } catch {
      return ceiling.toString();
    }
  }

  /**
   * Wraps a signed transaction in a fee bump with a higher fee, for a resolver
   * transaction stuck in the queue. The fee is capped at {@link maxFee} per
   * operation (plus the inner resource fee is already in the inner fee).
   */
  async feeBump(
    inner: Transaction,
    feeSource: Keypair,
    newBaseFee: string,
  ): Promise<SubmitResult> {
    const capped =
      BigInt(newBaseFee) > this.maxFee ? this.maxFee : BigInt(newBaseFee);
    const bump = TransactionBuilder.buildFeeBumpTransaction(
      feeSource,
      capped.toString(),
      inner,
      this.config.networkPassphrase,
    );
    bump.sign(feeSource);
    this.logger.log(`Fee-bumping ${this.hashHex(inner)} to ${capped} stroops`);
    const sent = await this.server.sendTransaction(bump);
    if (sent.status === 'ERROR') {
      return {
        hash: sent.hash,
        confirmed: false,
        error: `Network rejected the fee bump: ${JSON.stringify(sent.errorResult ?? {})}`,
      };
    }
    // The inner hash is what the wager records, and it is what confirms.
    return this.waitForConfirmation(this.hashHex(inner));
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
    const rpcMethod = `readContract:${method}`;
    const start = Date.now();
    try {
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

      const result = scValToNative(simulation.result.retval);
      this.metricsService?.rpcCallDuration.observe(
        { method: rpcMethod, success: 'true' },
        (Date.now() - start) / 1000,
      );
      return result;
    } catch (error) {
      this.metricsService?.rpcCallDuration.observe(
        { method: rpcMethod, success: 'false' },
        (Date.now() - start) / 1000,
      );
      this.metricsService?.rpcCallErrors.inc({ method: rpcMethod });
      throw error;
    }
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
    const start = Date.now();
    for (const signer of signers) {
      transaction.sign(signer);
    }
    const result = await this.submit(transaction);
    this.metricsService?.rpcCallDuration.observe(
      { method: 'signAndSubmit', success: result.confirmed ? 'true' : 'false' },
      (Date.now() - start) / 1000,
    );
    if (!result.confirmed) {
      this.metricsService?.rpcCallErrors.inc({ method: 'signAndSubmit' });
    }
    return result;
  }

  /** Submits an already-signed transaction and waits for confirmation. */
  async submit(transaction: Transaction): Promise<SubmitResult> {
    const hash = this.hashHex(transaction);
    const start = Date.now();
    const span: Span = getTracer('stellar-rpc').startSpan('StellarRpcService.submit', {
      attributes: { 'transaction.hash': hash, transaction_hash: hash },
    });

    const maxRetries = envInt('STELLAR_TRY_AGAIN_MAX_ATTEMPTS', 5);
    const baseDelayMs = envInt('STELLAR_TRY_AGAIN_BASE_DELAY_MS', 500);

    let sent: rpc.Api.SendTransactionResponse;
    let attemptCount = 0;
    try {
      for (let attempt = 0; ; attempt++) {
        attemptCount = attempt + 1;
        span.setAttribute('attempt_count', attemptCount);
        try {
          sent = await this.server.sendTransaction(transaction);
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
          this.metricsService?.rpcCallErrors.inc({ method: 'submit' });
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
          const err = `Network queue still full after ${attempt + 1} submissions (TRY_AGAIN_LATER)`;
          span.setStatus({ code: SpanStatusCode.ERROR, message: err });
          this.metricsService?.rpcCallErrors.inc({ method: 'submit' });
          return {
            hash,
            confirmed: false,
            error: err,
          };
        }

        const delay = baseDelayMs * 2 ** attempt;
        this.logger.warn(
          `TRY_AGAIN_LATER for ${hash} (attempt ${attempt + 1}), retrying in ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      if (sent.status === 'ERROR') {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'ERROR' });
        this.metricsService?.rpcCallErrors.inc({ method: 'submit' });
        return {
          hash,
          confirmed: false,
          error: `Network rejected transaction: ${JSON.stringify(sent.errorResult ?? {})}`,
        };
      }

      const result = await this.waitForConfirmation(hash);
      span.setAttribute('confirmed', result.confirmed);
      if (!result.confirmed) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: result.error ?? 'not confirmed' });
      }
      return result;
    } finally {
      span.setAttribute('attempt_count', attemptCount);
      this.metricsService?.rpcCallDuration.observe(
        { method: 'submit', success: 'true' },
        (Date.now() - start) / 1000,
      );
      span.end();
    }
  }

  /**
   * Polls the network until a submitted transaction is included in a ledger
   * or the poll budget runs out. Each poll is recorded as an attempt on the
   * `waitForConfirmation` span.
   */
  async waitForConfirmation(hash: string): Promise<SubmitResult> {
    const span: Span = getTracer('stellar-rpc').startSpan(
      'StellarRpcService.waitForConfirmation',
      { attributes: { 'transaction.hash': hash, transaction_hash: hash } },
    );
    const maxPolls = envInt('STELLAR_CONFIRMATION_MAX_POLLS', 15);
    const intervalMs = envInt('STELLAR_CONFIRMATION_INTERVAL_MS', 1500);
    let polls = 0;
    try {
      for (let i = 0; i < maxPolls; i++) {
        polls = i + 1;
        span.setAttribute('attempt_count', polls);
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        const status = await this.server.getTransaction(hash);
        if (status.status === 'SUCCESS') {
          span.setAttribute('ledger', status.ledger);
          span.setAttribute('confirmed', true);
          return {
            hash,
            confirmed: true,
            ledger: status.ledger,
            returnValue: status.returnValue
              ? scValToNative(status.returnValue)
              : undefined,
          };
        }
        if (status.status === 'FAILED') {
          span.setAttribute('confirmed', false);
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'FAILED' });
          return {
            hash,
            confirmed: false,
            ledger: status.ledger,
            error: `Transaction failed on-chain: ${JSON.stringify(status.resultXdr ?? '')}`,
          };
        }
      }
      span.setAttribute('confirmed', false);
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'timed out' });
      return {
        hash,
        confirmed: false,
        error: `Transaction not confirmed after ${maxPolls} polls`,
      };
    } finally {
      span.setAttribute('attempt_count', polls);
      span.end();
    }
  }

  /** Hex-encoded transaction hash. */
  private hashHex(transaction: Transaction): string {
    return Buffer.from(transaction.hash()).toString('hex');
  }
}
