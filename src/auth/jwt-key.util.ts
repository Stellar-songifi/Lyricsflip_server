import { createHash } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { JwtVerifyOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export function jwtKeyId(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function jwtSecretForToken(
  token: string,
  currentSecret: string,
  previousSecret?: string,
): string {
  const [encodedHeader, , signature] = token.split('.');
  if (!encodedHeader || !signature) {
    throw new UnauthorizedException('Token is invalid');
  }

  let parsedHeader: unknown;
  try {
    parsedHeader = JSON.parse(
      Buffer.from(encodedHeader, 'base64url').toString('utf8'),
    );
  } catch {
    throw new UnauthorizedException('Token is invalid');
  }
  if (
    !parsedHeader ||
    typeof parsedHeader !== 'object' ||
    Array.isArray(parsedHeader)
  ) {
    throw new UnauthorizedException('Token is invalid');
  }
  const header = parsedHeader as { kid?: unknown };

  if (header.kid !== undefined) {
    if (header.kid === jwtKeyId(currentSecret)) return currentSecret;
    if (previousSecret && header.kid === jwtKeyId(previousSecret)) {
      return previousSecret;
    }
    throw new UnauthorizedException('Token is invalid');
  }

  return previousSecret ?? currentSecret;
}

export function jwtVerifyOptions(
  token: string,
  configService: ConfigService,
): JwtVerifyOptions {
  const currentSecret = configService.get<string>('JWT_SECRET');
  if (!currentSecret) {
    throw new Error('JWT_SECRET is not set in environment variables');
  }

  return {
    secret: jwtSecretForToken(
      token,
      currentSecret,
      configService.get<string>('JWT_SECRET_PREVIOUS'),
    ),
    issuer: configService.get<string>('JWT_ISSUER', 'lyricsflip'),
    audience: configService.get<string>('JWT_AUDIENCE', 'lyricsflip-api'),
    algorithms: ['HS256'],
  };
}
