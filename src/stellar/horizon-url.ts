import { runtimeEnv } from '../config/runtime-env';
export function getHorizonUrl(): string {
  return (
    runtimeEnv().STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org'
  );
}
