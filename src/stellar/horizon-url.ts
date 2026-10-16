import { ConfigService } from '@nestjs/config';

export function getHorizonUrl(configService?: ConfigService): string {
  return (
    configService?.get<string>('STELLAR_HORIZON_URL') ??
    'https://horizon-testnet.stellar.org'
  );
}
