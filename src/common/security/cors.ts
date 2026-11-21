const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:3000';

export function allowedOrigins(
  frontendUrl = process.env.FRONTEND_URL || DEFAULT_FRONTEND_ORIGIN,
): string[] {
  return frontendUrl
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function allowsWebSocketOrigin(origin?: string): boolean {
  if (origin === undefined) {
    return allowsWebSocketWithoutOrigin();
  }

  return allowedOrigins().includes(origin);
}

export function allowsWebSocketWithoutOrigin(): boolean {
  return process.env.WS_ALLOW_NO_ORIGIN?.toLowerCase() !== 'false';
}
