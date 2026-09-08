/**
 * Dependency-injection tokens and protocol constants for the Stellar layer.
 */

/** Injection token for the resolved, validated {@link StellarConfig}. */
export const STELLAR_CONFIG = Symbol('STELLAR_CONFIG');

/** Injection token for the {@link IKeyStore} implementation in use. */
export const KEY_STORE = Symbol('KEY_STORE');

/**
 * Number of decimal places used by the LYRIC game token.
 *
 * Seven is the Stellar convention: classic assets and the Stellar Asset
 * Contract both use 7 decimals, so a "stroop" is 1e-7 of a token.
 */
export const TOKEN_DECIMALS = 7;

/** 10 ** TOKEN_DECIMALS — the number of stroops in one whole token. */
export const STROOPS_PER_TOKEN = 10n ** BigInt(TOKEN_DECIMALS);

/**
 * Soroban contracts store i128 amounts. These are the inclusive bounds; any
 * amount outside them is rejected before it is ever sent to the network.
 */
export const I128_MAX = 2n ** 127n - 1n;
export const I128_MIN = -(2n ** 127n);

/** Default per-transaction fee, in stroops of XLM (0.1 XLM). */
export const DEFAULT_MAX_FEE = '1000000';

/** How long a built transaction stays valid before the network rejects it. */
export const TRANSACTION_TIMEOUT_SECONDS = 180;

/** SEP-10 web-auth challenge lifetime, in seconds. */
export const CHALLENGE_TIMEOUT_SECONDS = 300;
