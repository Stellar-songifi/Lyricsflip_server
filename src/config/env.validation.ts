import * as Joi from 'joi';
import { ACCEPTED_LOG_LEVELS } from '../common/services/log-level';

/**
 * Validates every environment variable the app reads at boot.
 *
 * Passed to `ConfigModule.forRoot({ validationSchema })`, so a missing or
 * malformed value fails startup with a message naming the offending key
 * instead of surfacing later as an obscure runtime error.
 */
/** Required unless DATABASE_URL is set, which then supplies the value. */
const requiredWithoutDatabaseUrl = (schema: Joi.StringSchema) =>
  schema.when('DATABASE_URL', {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.required(),
  });

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  // Interface to listen on. 0.0.0.0 (all interfaces) so the server is
  // reachable through a container's published port; set 127.0.0.1 to accept
  // local connections only.
  HOST: Joi.alternatives()
    .try(Joi.string().ip(), Joi.string().hostname())
    .default('0.0.0.0'),
  // Winston levels, plus Nest's `log` (mapped to `info`) for compatibility.
  // Default: info in production, debug otherwise (#359).
  LOG_LEVEL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .valid(...ACCEPTED_LOG_LEVELS)
      .default('info'),
    otherwise: Joi.string()
      .valid(...ACCEPTED_LOG_LEVELS)
      .default('debug'),
  }),
  FRONTEND_URL: Joi.string().uri().default('http://localhost:3000'),

  // HTTP server limits and timeouts (#R2-120). Tune for the load balancer in
  // front of the app; see docs/deployment.md for recommended values.
  // - HTTP_JSON_BODY_LIMIT / HTTP_URLENCODED_BODY_LIMIT: body-parser size limits.
  // - HTTP_REQUEST_TIMEOUT_MS: max time to receive a full request (slow-loris guard).
  // - HTTP_HEADERS_TIMEOUT_MS: max time to receive request headers. Must be
  //   <= HTTP_REQUEST_TIMEOUT_MS per Node.js.
  // - HTTP_KEEP_ALIVE_TIMEOUT_MS: idle keep-alive lifetime. Keep it longer than
  //   the load balancer's idle timeout (AWS ALB default 60 s) to avoid 502s.
  HTTP_JSON_BODY_LIMIT: Joi.string().default('100kb'),
  HTTP_URLENCODED_BODY_LIMIT: Joi.string().default('100kb'),
  HTTP_REQUEST_TIMEOUT_MS: Joi.number().integer().min(0).default(30000),
  HTTP_HEADERS_TIMEOUT_MS: Joi.number()
    .integer()
    .min(0)
    .default(20000)
    .when('HTTP_REQUEST_TIMEOUT_MS', {
      is: Joi.number().integer().min(1),
      then: Joi.number().integer().min(0).max(Joi.ref('HTTP_REQUEST_TIMEOUT_MS')),
    }),
  HTTP_KEEP_ALIVE_TIMEOUT_MS: Joi.number().integer().min(1000).default(65000),

  // Auth
  // Auth. JWT_SECRET must be at least 32 characters in every environment
  // except `test`, where short throwaway secrets are allowed.
  JWT_SECRET: Joi.string()
    .required()
    .when('NODE_ENV', {
      is: 'test',
      then: Joi.string().min(1).required(),
      otherwise: Joi.string().min(32).required(),
    }),
  JWT_EXPIRES_IN: Joi.string().default('15m'),

  // Swagger UI. Off by default in production; must be set explicitly there
  // (see ProductionSafetyCheck).
  SWAGGER_ENABLED: Joi.string()
    .valid('true', 'false')
    .default('false'),

  // Gameplay. ROUND_ANSWER_WINDOW_SECONDS is how long a player has to score on
  // a round; SESSION_TIMEOUT_MINUTES is how long a session may sit idle.
  ROUND_ANSWER_WINDOW_SECONDS: Joi.number().integer().min(1).default(20),
  SESSION_TIMEOUT_MINUTES: Joi.number().integer().min(1).default(30),

  // Misc. SEED_ADMIN_* are read by ProductionSafetyCheck to refuse booting
  // production with the seed's default admin credentials still in place.
  INVITATION_TTL_MINUTES: Joi.number().positive().default(30),
  SEED_ADMIN_EMAIL: Joi.string().email().optional(),
  SEED_ADMIN_PASSWORD: Joi.string().optional(),

  // Database (src/config/database.config.ts). Either DATABASE_URL, which
  // takes precedence, or the discrete DB_* variables.
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .optional(),
  DB_HOST: requiredWithoutDatabaseUrl(Joi.string()),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: requiredWithoutDatabaseUrl(Joi.string()),
  DB_PASSWORD: requiredWithoutDatabaseUrl(Joi.string()),
  DB_NAME: requiredWithoutDatabaseUrl(Joi.string()),
  // TLS: disable (default), require (encrypted, certificate not verified), or
  // verify-full (verified against DB_SSL_CA or the system CAs). When unset,
  // an sslmode in DATABASE_URL applies.
  DB_SSL: Joi.string().valid('disable', 'require', 'verify-full').optional(),
  // CA certificate: the PEM itself (literal \n accepted) or a path to it.
  DB_SSL_CA: Joi.string().optional(),
  DB_REPLICA_HOST: Joi.string().optional(),
  DB_REPLICA_PORT: Joi.number().port().optional(),
  DB_REPLICA_USERNAME: Joi.string().optional(),
  DB_REPLICA_PASSWORD: Joi.string().optional(),
  DB_REPLICA_NAME: Joi.string().optional(),

  // TypeORM logging and pool configuration (#202)
  // DB_LOGGING: 'all', 'false', or comma-separated TypeORM log levels
  //   e.g. 'error,warn,slow'  (default: 'error' in prod, 'error,warn,slow' in dev)
  DB_LOGGING: Joi.string().optional(),
  DB_POOL_SIZE: Joi.number().integer().min(1).default(10),
  DB_SLOW_QUERY_THRESHOLD_MS: Joi.number().integer().min(0).default(250),

  // Mail transport (#262). All optional: when MAIL_HOST is unset the mailer
  // falls back to a console/no-op transport, which is what development and
  // tests use.
  MAIL_HOST: Joi.string().optional().allow(''),
  MAIL_PORT: Joi.number().port().default(587),
  MAIL_USER: Joi.string().optional().allow(''),
  MAIL_PASSWORD: Joi.string().optional().allow(''),
  MAIL_FROM: Joi.string().email().default('no-reply@lyricsflip.local'),
  MAIL_SECURE: Joi.string().valid('true', 'false').default('false'),

  // Redis cache (#201). Optional: when unset the app falls back to memory cache.
  REDIS_URL: Joi.string().uri().optional(),

  // Winston file logging (#200). Set to 'true' to write rotating log files.
  LOG_TO_FILE: Joi.string().valid('true', 'false').default('false'),

  // Stellar / Soroban settlement. Kept permissive here - loadStellarConfig
  // (src/stellar/stellar.config.ts) re-validates format and cross-field
  // requirements (e.g. contract IDs only when STELLAR_SETTLEMENT_MODE=stellar).
  STELLAR_SETTLEMENT_MODE: Joi.string().valid('mock', 'stellar').default('mock'),
  STELLAR_NETWORK: Joi.string()
    .valid('public', 'testnet', 'futurenet', 'standalone')
    .default('testnet'),
  STELLAR_CUSTODY_MODE: Joi.string()
    .valid('custodial', 'non-custodial')
    .default('non-custodial'),
  STELLAR_KEY_STORE: Joi.string().valid('env', 'kms', 'vault').default('env'),
  STELLAR_RPC_URL: Joi.string().uri().optional(),
  STELLAR_HORIZON_URL: Joi.string().uri().optional(),
  STELLAR_NETWORK_PASSPHRASE: Joi.string().optional(),
  STELLAR_ESCROW_CONTRACT_ID: Joi.string().optional().allow(''),
  STELLAR_TOKEN_CONTRACT_ID: Joi.string().optional().allow(''),
  STELLAR_RESOLVER_SECRET: Joi.string().optional().allow(''),
  STELLAR_CUSTODIAL_MASTER_SEED: Joi.string().optional().allow(''),
  STELLAR_WEB_AUTH_DOMAIN: Joi.string().default('localhost'),
  STELLAR_WEB_AUTH_SECRET: Joi.string().optional().allow(''),

  // KMS / Vault key store (STELLAR_KEY_STORE=kms|vault). Optional because
  // they are only required when that store is selected; KmsKeyStore itself
  // throws a specific error naming whichever of these is missing.
  STELLAR_KMS_KEY_ID: Joi.string().optional(),
  STELLAR_KMS_REGION: Joi.string().optional(),
  STELLAR_VAULT_ADDR: Joi.string().uri().optional(),
  STELLAR_VAULT_TOKEN: Joi.string().optional(),
  STELLAR_VAULT_TRANSIT_KEY: Joi.string().optional(),
  // Server / networking
  TRUST_PROXY: Joi.string().optional().allow(''),
  SETTLEMENT_DRAIN_TIMEOUT_MS: Joi.number().integer().min(1).default(30000),
  CACHE_MAX_ITEMS: Joi.number().integer().min(1).default(5000),
  CALIBRATION_ENABLED: Joi.string().valid('true', 'false').default('false'),
  DAILY_CHALLENGE_SALT: Joi.string().optional().allow(''),

  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().optional().allow(''),
  OTEL_SERVICE_NAME: Joi.string().optional().allow(''),
  // Either an IP allowlist or basic auth must be configured in production
  // (see ProductionSafetyCheck).
  METRICS_IP_ALLOWLIST: Joi.string().optional().allow(''),
  METRICS_BASIC_AUTH: Joi.string().optional().allow(''),

  // Stellar submission / polling tuning
  STELLAR_MAX_FEE: Joi.number().integer().min(1).optional(),
  STELLAR_TRY_AGAIN_MAX_ATTEMPTS: Joi.number().integer().min(0).default(5),
  STELLAR_TRY_AGAIN_BASE_DELAY_MS: Joi.number().integer().min(0).default(500),
  STELLAR_POLL_ATTEMPTS: Joi.number().integer().min(0).default(15),
  STELLAR_POLL_SLEEP_STRATEGY: Joi.string()
    .valid('linear', 'basic')
    .default('linear'),
  LYRIC_TOKEN_DECIMALS: Joi.number().integer().min(0).max(18).optional(),

  // Wager reconciliation
  WAGER_RECONCILE_MIN_AGE_SECONDS: Joi.number().integer().min(1).default(120),
  WAGER_RECONCILE_MAX_ATTEMPTS: Joi.number().integer().min(1).default(8),
  WAGER_RECONCILE_BASE_DELAY_SECONDS: Joi.number()
    .integer()
    .min(1)
    .default(60),

  // Rate limiting (ttl in ms, limit in requests per window)
  THROTTLE_TTL_MS: Joi.number().integer().min(1).default(60000),
  THROTTLE_LIMIT: Joi.number().integer().min(1).default(100),
  THROTTLE_AUTH_TTL_MS: Joi.number().integer().min(1).default(60000),
  THROTTLE_AUTH_LIMIT: Joi.number().integer().min(1).default(5),
  THROTTLE_STELLAR_TTL_MS: Joi.number().integer().min(1).default(60000),
  THROTTLE_STELLAR_LIMIT: Joi.number().integer().min(1).default(10),
  THROTTLE_GUESS_TTL_MS: Joi.number().integer().min(1).default(60000),
  THROTTLE_GUESS_LIMIT: Joi.number().integer().min(1).default(30),
}).unknown(true);
