export interface TrustlineLike {
  asset_code?: string;
  asset_issuer?: string;
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
