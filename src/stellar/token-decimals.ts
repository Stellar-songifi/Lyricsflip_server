export const DEFAULT_TOKEN_DECIMALS = Number(process.env.LYRIC_TOKEN_DECIMALS ?? 7);

export function normalizeTokenAmount(raw: bigint, decimals = DEFAULT_TOKEN_DECIMALS): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = (raw % divisor).toString().padStart(decimals, "0");
  return `${whole}.${fraction}`;
}
