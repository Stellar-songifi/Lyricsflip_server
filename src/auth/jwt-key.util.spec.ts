import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { jwtKeyId, jwtVerifyOptions } from './jwt-key.util';

describe('JWT verification options', () => {
  const currentSecret = 'current-secret-with-at-least-32-characters';
  const previousSecret = 'previous-secret-with-at-least-32-characters';
  const config = (previous?: string) =>
    ({
      get: (name: string, fallback?: string) =>
        ({
          JWT_SECRET: currentSecret,
          JWT_SECRET_PREVIOUS: previous,
          JWT_ISSUER: 'test-issuer',
          JWT_AUDIENCE: 'test-audience',
        })[name] ?? fallback,
    }) as ConfigService;

  it('pins issuer, audience and HS256 while accepting a previous key by kid', async () => {
    const jwt = new JwtService({ secret: previousSecret });
    const token = jwt.sign(
      { sub: 'user-1' },
      {
        secret: previousSecret,
        algorithm: 'HS256',
        keyid: jwtKeyId(previousSecret),
        issuer: 'test-issuer',
        audience: 'test-audience',
      },
    );

    await expect(
      jwt.verifyAsync(token, jwtVerifyOptions(token, config(previousSecret))),
    ).resolves.toMatchObject({ sub: 'user-1' });
    expect(jwtVerifyOptions(token, config(previousSecret))).toMatchObject({
      issuer: 'test-issuer',
      audience: 'test-audience',
      algorithms: ['HS256'],
      secret: previousSecret,
    });
  });

  it.each([
    ['issuer', { issuer: 'wrong-issuer' }],
    ['audience', { audience: 'wrong-audience' }],
    ['algorithm', { algorithm: 'HS384' as const }],
  ])('rejects a token with an invalid %s', async (_claim, overrides) => {
    const jwt = new JwtService({ secret: currentSecret });
    const token = jwt.sign(
      { sub: 'user-1' },
      {
        secret: currentSecret,
        algorithm: 'HS256',
        keyid: jwtKeyId(currentSecret),
        issuer: 'test-issuer',
        audience: 'test-audience',
        ...overrides,
      },
    );

    await expect(
      jwt.verifyAsync(token, jwtVerifyOptions(token, config())),
    ).rejects.toThrow();
  });

  it('uses the previous key for legacy tokens without a kid during rotation', async () => {
    const jwt = new JwtService({ secret: previousSecret });
    const token = jwt.sign(
      { sub: 'user-1' },
      {
        secret: previousSecret,
        algorithm: 'HS256',
        issuer: 'test-issuer',
        audience: 'test-audience',
      },
    );

    expect(jwtVerifyOptions(token, config(previousSecret)).secret).toBe(
      previousSecret,
    );
    await expect(
      jwt.verifyAsync(token, jwtVerifyOptions(token, config(previousSecret))),
    ).resolves.toMatchObject({ sub: 'user-1' });
  });
});
