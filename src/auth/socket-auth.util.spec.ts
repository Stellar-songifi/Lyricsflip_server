import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { jwtKeyId } from './jwt-key.util';
import { authenticateSocket } from './socket-auth.util';

describe('WebSocket JWT authentication', () => {
  const currentSecret = 'current-secret-with-at-least-32-characters';
  const previousSecret = 'previous-secret-with-at-least-32-characters';
  const issuer = 'test-issuer';
  const audience = 'test-audience';
  const jwt = new JwtService();

  const config = (previous?: string) =>
    ({
      get: (name: string, fallback?: string) =>
        ({
          JWT_SECRET: currentSecret,
          JWT_SECRET_PREVIOUS: previous,
          JWT_ISSUER: issuer,
          JWT_AUDIENCE: audience,
        })[name] ?? fallback,
    }) as ConfigService;

  const clientFor = (token: string) => ({
    handshake: { auth: { token }, headers: {} },
  });

  const signToken = (
    secret: string,
    overrides: {
      algorithm?: 'HS256' | 'HS384';
      issuer?: string;
      audience?: string;
      keyid?: string;
    } = {},
  ) =>
    jwt.sign(
      { sub: 'user-1', username: 'player' },
      {
        secret,
        algorithm: overrides.algorithm ?? 'HS256',
        keyid: overrides.keyid ?? jwtKeyId(secret),
        issuer: overrides.issuer ?? issuer,
        audience: overrides.audience ?? audience,
      },
    );

  it('accepts a token signed with the configured previous key', async () => {
    const token = signToken(previousSecret);

    await expect(
      authenticateSocket(clientFor(token), jwt, config(previousSecret)),
    ).resolves.toEqual({ id: 'user-1', username: 'player', role: undefined });
  });

  it.each([
    ['issuer', { issuer: 'wrong-issuer' }],
    ['audience', { audience: 'wrong-audience' }],
    ['algorithm', { algorithm: 'HS384' as const }],
  ])('rejects a token with an invalid %s', async (_claim, overrides) => {
    const token = signToken(currentSecret, overrides);

    await expect(
      authenticateSocket(clientFor(token), jwt, config()),
    ).rejects.toThrow();
  });
});
