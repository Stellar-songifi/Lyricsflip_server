import { StellarController } from './stellar.controller';
import { StellarRpcService } from './services/stellar-rpc.service';
import { TOKEN_DECIMALS } from './stellar.constants';
import type { StellarConfig } from './stellar.config';

describe('StellarController', () => {
  let controller: StellarController;
  let config: StellarConfig;
  let rpc: jest.Mocked<Pick<StellarRpcService, 'isHealthy'>>;

  const build = (overrides: Partial<StellarConfig> = {}) => {
    config = {
      settlementMode: 'stellar',
      custodyMode: 'non-custodial',
      network: 'testnet',
      networkPassphrase: 'Test SDF Network ; September 2015',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      escrowContractId: 'CESCROW',
      tokenContractId: 'CTOKEN',
      resolverPublicKey: 'GRESOLVER',
      ...overrides,
    } as StellarConfig;

    rpc = { isHealthy: jest.fn() };

    controller = new StellarController(
      config,
      rpc as unknown as StellarRpcService,
    );
  };

  beforeEach(() => build());

  describe('getInfo', () => {
    it('reports the network and contracts the backend is wired to', () => {
      expect(controller.getInfo()).toEqual({
        settlementMode: 'stellar',
        custodyMode: 'non-custodial',
        network: 'testnet',
        networkPassphrase: 'Test SDF Network ; September 2015',
        rpcUrl: 'https://soroban-testnet.stellar.org',
        horizonUrl: 'https://horizon-testnet.stellar.org',
        escrowContractId: 'CESCROW',
        tokenContractId: 'CTOKEN',
        resolverPublicKey: 'GRESOLVER',
        tokenDecimals: TOKEN_DECIMALS,
      });
    });

    it('publishes the resolver so players can check who can release their pot', () => {
      expect(controller.getInfo().resolverPublicKey).toBe('GRESOLVER');
    });

    it('reports unset contract details as null rather than empty strings', () => {
      build({
        settlementMode: 'mock',
        escrowContractId: '',
        tokenContractId: '',
        resolverPublicKey: '',
      });

      expect(controller.getInfo()).toMatchObject({
        escrowContractId: null,
        tokenContractId: null,
        resolverPublicKey: null,
      });
    });

    it('never leaks a secret key', () => {
      const serialised = JSON.stringify(controller.getInfo());

      expect(serialised).not.toMatch(/secret|seed|"S[A-Z2-7]{55}"/i);
    });
  });

  describe('getHealth', () => {
    it('skips the RPC probe entirely in mock settlement mode', async () => {
      build({ settlementMode: 'mock' });

      await expect(controller.getHealth()).resolves.toEqual({
        settlementMode: 'mock',
        rpcHealthy: null,
        message: 'Mock settlement; no RPC in use',
      });
      expect(rpc.isHealthy).not.toHaveBeenCalled();
    });

    it('reports a reachable RPC endpoint', async () => {
      rpc.isHealthy.mockResolvedValue(true);

      await expect(controller.getHealth()).resolves.toEqual({
        settlementMode: 'stellar',
        network: 'testnet',
        rpcHealthy: true,
        message: 'Soroban RPC reachable',
      });
    });

    it('reports an unreachable RPC endpoint without throwing', async () => {
      rpc.isHealthy.mockResolvedValue(false);

      await expect(controller.getHealth()).resolves.toEqual({
        settlementMode: 'stellar',
        network: 'testnet',
        rpcHealthy: false,
        message: 'Soroban RPC unreachable',
      });
    });
  });
});
