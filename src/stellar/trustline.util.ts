export interface TrustlineLike {
  asset_code?: string;
  asset_issuer?: string;
}

export interface TrustlineCheckResult {
  ok: boolean;
  reason?: string;
}

export function hasTrustline(
  balances: TrustlineLike[],
  assetCode: string,
  assetIssuer: string,
): boolean {
  return balances.some(
    (balance) => balance.asset_code === assetCode && balance.asset_issuer === assetIssuer,
  );
}

/**
 * A SAC-wrapped classic asset is identified by a non-empty asset code and
 * issuer. Native Soroban tokens (e.g. the LYRIC token itself) have neither and
 * therefore do not require a trustline.
 */
export function requiresTrustline(assetCode?: string, assetIssuer?: string): boolean {
  return Boolean(assetCode && assetIssuer);
}

/**
 * Verify that an account can receive the given token. For native Soroban
 * tokens no trustline is needed, so the check passes without inspecting
 * balances. For SAC-wrapped classic assets the account must hold a matching
 * trustline.
 */
export function canReceiveToken(
  balances: TrustlineLike[],
  assetCode?: string,
  assetIssuer?: string,
): TrustlineCheckResult {
  if (!requiresTrustline(assetCode, assetIssuer)) {
    return { ok: true };
  }

  if (hasTrustline(balances, assetCode as string, assetIssuer as string)) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: `Account is missing a trustline for ${assetCode}:${assetIssuer}`,
  };
}

/**
 * Pre-flight trustline check used before staking so that a payout can reach
 * the player. Accepts either a list of balances or an account object that
 * carries a `balances` array. Delegates to {@link canReceiveToken}.
 */
export function checkTrustline(
  balancesOrAccount: TrustlineLike[] | { balances?: TrustlineLike[] } | null | undefined,
  assetCode?: string,
  assetIssuer?: string,
): TrustlineCheckResult {
  const balances: TrustlineLike[] = Array.isArray(balancesOrAccount)
    ? balancesOrAccount
    : balancesOrAccount && Array.isArray(balancesOrAccount.balances)
      ? balancesOrAccount.balances
      : [];

  return canReceiveToken(balances, assetCode, assetIssuer);
}