import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { jwtKeyId } from '../jwt-key.util';
import { JwtStrategy } from './jwt.strategy';

describe('HTTP JWT strategy verification', () => {
  const currentSecret = 'current-secret-with-at-least-32-characters';
  const previousSecret = 'previous-secret-with-at-least-32-characters';
  const issuer = 'test-issuer';
  const audience = 'test-audience';
  const jwt = new JwtService();
  const userRepository = {
    findOne: jest.fn().mockResolvedValue({
      id: 'user-1',
      isActive: true,
      tokenVersion: 0,
    }),
  } as unknown as Repository<User>;

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

  const signToken = (
    secret: string,
    overrides: {
      algorithm?: 'HS256' | 'HS384';
      issuer?: string;
      audience?: string;
    } = {},
  ) =>
    jwt.sign(
      { sub: 'user-1', tokenVersion: 0 },
      {
        secret,
        algorithm: overrides.algorithm ?? 'HS256',
        keyid: jwtKeyId(secret),
        issuer: overrides.issuer ?? issuer,
        audience: overrides.audience ?? audience,
      },
    );

  const authenticate = (token: string, previous?: string): Promise<boolean> => {
    const strategy = new JwtStrategy(userRepository, config(previous));

    return new Promise((resolve, reject) => {
      strategy.success = () => resolve(true);
      strategy.fail = () => resolve(false);
      strategy.error = (error) => reject(error);
      strategy.authenticate({
        headers: { authorization: `Bearer ${token}` },
      } as unknown as Request);
    });
  };

  it('accepts a valid token signed with the previous key', async () => {
    expect(await authenticate(signToken(previousSecret), previousSecret)).toBe(
      true,
    );
  });

  it.each([
    ['issuer', { issuer: 'wrong-issuer' }],
    ['audience', { audience: 'wrong-audience' }],
    ['algorithm', { algorithm: 'HS384' as const }],
  ])('rejects a token with an invalid %s', async (_claim, overrides) => {
    expect(await authenticate(signToken(currentSecret, overrides))).toBe(false);
  });
});
