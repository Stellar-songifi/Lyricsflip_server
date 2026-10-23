import * as Joi from 'joi';

/**
 * Validates every environment variable the app reads at boot.
 *
 * Passed to `ConfigModule.forRoot({ validationSchema })`, so a missing or
 * malformed value fails startup with a message naming the offending key
 * instead of surfacing later as an obscure runtime error.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'log', 'debug', 'verbose')
    .default('debug'),
  FRONTEND_URL: Joi.string().uri().default('http://localhost:3000'),

  // Auth
  JWT_SECRET: Joi.string()
    .min(32)
    .required()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().min(32).required(),
      otherwise: Joi.string().min(1).required(),
    }),
  JWT_EXPIRES_IN: Joi.string().default('15m'),

  // Gameplay. ROUND_ANSWER_WINDOW_SECONDS is how long a player has to score on
  // a round; SESSION_TIMEOUT_MINUTES is how long a session may sit idle.
  ROUND_ANSWER_WINDOW_SECONDS: Joi.number().integer().min(1).default(20),
  SESSION_TIMEOUT_MINUTES: Joi.number().integer().min(1).default(30),

  // Misc
  INVITATION_TTL_MINUTES: Joi.number().positive().default(30),
  SEED_ADMIN_EMAIL: Joi.string().email().optional(),
  SEED_ADMIN_PASSWORD: Joi.string().optional(),

  // Database. DATABASE_URL is accepted as an alternative to the discrete
  // DB_* variables, but nothing currently reads it directly - it is kept
  // here only so setting it does not fail validation.
  DATABASE_URL: Joi.string().uri().optional(),
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
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
  HOST: Joi.string().default('0.0.0.0'),
  TRUST_PROXY: Joi.string().optional().allow(''),
  SETTLEMENT_DRAIN_TIMEOUT_MS: Joi.number().integer().min(1).default(30000),
  CACHE_MAX_ITEMS: Joi.number().integer().min(1).default(5000),
  CALIBRATION_ENABLED: Joi.string().valid('true', 'false').default('false'),
  DAILY_CHALLENGE_SALT: Joi.string().optional().allow(''),

  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().optional().allow(''),
  OTEL_SERVICE_NAME: Joi.string().optional().allow(''),
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
