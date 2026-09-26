export function getHorizonUrl(): string {
  return process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
}
