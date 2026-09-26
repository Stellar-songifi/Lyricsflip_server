import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { Repository } from 'typeorm';
import { Transaction } from '@stellar/stellar-sdk';
import { StellarTokenService } from './stellar-token.service';
import { User } from '../../users/entities/user.entity';
import { EscrowContext, SettlementStatus } from '../interfaces/token.interface';
import {
  EscrowContractService,
  PotStatus,
} from '../../stellar/services/escrow-contract.service';
import {
  StellarRpcService,
  SubmitResult,
} from '../../stellar/services/stellar-rpc.service';
import { IKeyStore } from '../../stellar/interfaces/key-store.interface';
import type { StellarConfig } from '../../stellar/stellar.config';

const SESSION_ID = '3f1e4b2a-9c8d-4e7f-a1b2-c3d4e5f60718';

describe('StellarTokenService', () => {
  let service: StellarTokenService;
  let userRepository: { findOne: jest.Mock };
  // `custodial` is readonly on the interface, but these tests flip it to
  // exercise both custody modes against the same service.
  let keyStore: jest.Mocked<Omit<IKeyStore, 'name' | 'custodial'>> & {
    name: string;
    custodial: boolean;
  };
  let escrow: jest.Mocked<
    Pick<
      EscrowContractService,
      | 'openPot'
      | 'buildStake'
      | 'buildUnsignedStake'
      | 'submitSignedStake'
      | 'resolve'
      | 'refund'
      | 'getPot'
      | 'getTokenBalance'
    >
  >;
  let rpc: jest.Mocked<
    Pick<StellarRpcService, 'signAndSubmit' | 'lookupTransaction'>
  >;
  let resolver: Keypair;
  let context: EscrowContext;

  const addressA = Keypair.random().publicKey();
  const addressB = Keypair.random().publicKey();

  const confirmed: SubmitResult = {
    hash: 'hash-confirmed',
    confirmed: true,
    ledger: 4242,
  };
  const unconfirmed: SubmitResult = {
    hash: 'hash-unconfirmed',
    confirmed: false,
    error:
      'Transaction not yet visible on the network; awaiting reconciliation',
  };

  /** A user who has linked and verified a wallet. */
  const verifiedUser = (id: string, address: string): Partial<User> => ({
    id,
    username: `player-${id}`,
    stellarAddress: address,
    stellarAddressVerifiedAt: new Date('2026-01-01T00:00:00Z'),
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();

    resolver = Keypair.random();
    context = {
      sessionId: SESSION_ID,
      playerAId: 'user-a',
      playerBId: 'user-b',
      stake: '105000000',
    };

    userRepository = {
      findOne: jest.fn(({ where: { id } }) =>
        Promise.resolve(
          id === 'user-a'
            ? verifiedUser('user-a', addressA)
            : id === 'user-b'
              ? verifiedUser('user-b', addressB)
              : null,
        ),
      ),
    };

    keyStore = {
      name: 'test',
      custodial: false,
      getResolverKeypair: jest.fn().mockReturnValue(resolver),
      getPlayerSigner: jest.fn().mockResolvedValue(null),
      getPlayerAddress: jest.fn().mockResolvedValue(null),
    };

    escrow = {
      openPot: jest.fn().mockResolvedValue(confirmed),
      buildStake: jest.fn().mockResolvedValue({} as Transaction),
      buildUnsignedStake: jest.fn().mockResolvedValue({
        xdr: 'AAAA...',
        networkPassphrase: 'Test SDF Network ; September 2015',
        hash: 'hash-unsigned',
      }),
      submitSignedStake: jest.fn().mockResolvedValue(confirmed),
      resolve: jest.fn().mockResolvedValue(confirmed),
      refund: jest.fn().mockResolvedValue(confirmed),
      getPot: jest.fn().mockResolvedValue(null),
      getTokenBalance: jest.fn().mockResolvedValue('500000000'),
    };

    rpc = {
      signAndSubmit: jest.fn().mockResolvedValue(confirmed),
      lookupTransaction: jest.fn().mockResolvedValue(unconfirmed),
    };

    service = new StellarTokenService(
      userRepository as unknown as Repository<User>,
      { escrowContractId: 'C...', tokenContractId: 'C...' } as StellarConfig,
      keyStore as unknown as IKeyStore,
      escrow as unknown as EscrowContractService,
      rpc as unknown as StellarRpcService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('reports itself as the stellar settlement backend', () => {
    expect(service.settlementMode).toBe('stellar');
  });

  describe('wallet requirements', () => {
    it('refuses a user who has not linked a wallet', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-a',
        username: 'nolink',
        stellarAddress: null,
      });

      const result = await service.stakeTokens('user-a', context);

      expect(result.status).toBe(SettlementStatus.FAILED);
      expect(result.message).toMatch(/has not linked a Stellar wallet/);
      expect(escrow.buildUnsignedStake).not.toHaveBeenCalled();
    });

    it('refuses a linked but unverified wallet', async () => {
      // Paying a pot to an address nobody signed for is unrecoverable.
      userRepository.findOne.mockResolvedValue({
        id: 'user-a',
        username: 'unverified',
        stellarAddress: addressA,
        stellarAddressVerifiedAt: null,
      });

      const result = await service.stakeTokens('user-a', context);

      expect(result.status).toBe(SettlementStatus.FAILED);
      expect(result.message).toMatch(/not verified/);
    });

    it('refuses a user who does not exist', async () => {
      const result = await service.stakeTokens('ghost', context);

      expect(result.status).toBe(SettlementStatus.FAILED);
      expect(result.message).toMatch(/not found/);
    });

    it('does not open a pot when one player has no verified wallet', async () => {
      userRepository.findOne.mockImplementation(({ where: { id } }) =>
        Promise.resolve(
          id === 'user-a' ? verifiedUser('user-a', addressA) : null,
        ),
      );

      const result = await service.openEscrow(context);

      expect(result.status).toBe(SettlementStatus.FAILED);
      expect(escrow.openPot).not.toHaveBeenCalled();
    });
  });

  describe('openEscrow', () => {
    it('opens the pot for both verified players as the resolver', async () => {
      const result = await service.openEscrow(context);

      expect(escrow.openPot).toHaveBeenCalledWith(
        resolver,
        SESSION_ID,
        addressA,
        addressB,
        '105000000',
      );
      expect(result).toMatchObject({
        success: true,
        status: SettlementStatus.CONFIRMED,
        txHash: 'hash-confirmed',
        ledger: 4242,
      });
      expect(result.message).toContain('10.5 LYRIC');
    });
  });

  describe('stakeTokens in non-custodial mode', () => {
    it('returns an unsigned transaction for the wallet to sign', async () => {
      const result = await service.stakeTokens('user-a', context);

      expect(escrow.buildUnsignedStake).toHaveBeenCalledWith(
        SESSION_ID,
        addressA,
      );
      expect(result).toMatchObject({
        success: false,
        status: SettlementStatus.PENDING_SIGNATURE,
        txHash: 'hash-unsigned',
      });
      expect(result.unsignedTransaction?.xdr).toBe('AAAA...');
    });

    it('never signs or submits on the player behalf', async () => {
      await service.stakeTokens('user-a', context);

      expect(rpc.signAndSubmit).not.toHaveBeenCalled();
      expect(escrow.buildStake).not.toHaveBeenCalled();
    });

    it('does not report a pending signature as success', async () => {
      // The stake has not moved yet; a truthy success here would let the match
      // start against an unfunded pot.
      const result = await service.stakeTokens('user-a', context);

      expect(result.success).toBe(false);
    });
  });

  describe('stakeTokens in custodial mode', () => {
    let signer: Keypair;

    beforeEach(() => {
      signer = Keypair.random();
      keyStore.custodial = true;
      keyStore.getPlayerSigner.mockResolvedValue(signer);
    });

    it('signs and submits the stake itself', async () => {
      const built = { built: true } as unknown as Transaction;
      escrow.buildStake.mockResolvedValue(built);

      const result = await service.stakeTokens('user-a', context);

      expect(escrow.buildStake).toHaveBeenCalledWith(
        signer.publicKey(),
        SESSION_ID,
        addressA,
      );
      expect(rpc.signAndSubmit).toHaveBeenCalledWith(built, [signer]);
      expect(result).toMatchObject({
        success: true,
        status: SettlementStatus.CONFIRMED,
      });
      expect(escrow.buildUnsignedStake).not.toHaveBeenCalled();
    });

    it('includes the resulting balance when it can be read', async () => {
      const result = await service.stakeTokens('user-a', context);

      expect(result.newBalance).toBe('500000000');
    });

    it('still settles when the follow-up balance read fails', async () => {
      // The balance is informational; the transaction result is not.
      escrow.getTokenBalance.mockRejectedValue(new Error('rpc down'));

      const result = await service.stakeTokens('user-a', context);

      expect(result.success).toBe(true);
      expect(result.status).toBe(SettlementStatus.CONFIRMED);
      expect(result.newBalance).toBeUndefined();
    });
  });

  describe('confirmStake', () => {
    it("submits the signed XDR as the caller's stake for this session", async () => {
      const result = await service.confirmStake(
        'user-a',
        'SIGNED_XDR',
        context,
      );

      expect(escrow.submitSignedStake).toHaveBeenCalledWith(
        'SIGNED_XDR',
        SESSION_ID,
        addressA,
      );
      expect(result).toMatchObject({
        success: true,
        status: SettlementStatus.CONFIRMED,
      });
    });

    it('reports a rejected envelope as a failure', async () => {
      escrow.submitSignedStake.mockRejectedValue(new Error('bad envelope'));

      const result = await service.confirmStake('user-a', 'GARBAGE', context);

      expect(result).toMatchObject({
        success: false,
        status: SettlementStatus.FAILED,
      });
      expect(result.message).toMatch(/bad envelope/);
    });

    it('passes a forged envelope back to the client as a 400', async () => {
      escrow.submitSignedStake.mockRejectedValue(
        new BadRequestException('not the stake issued for this session'),
      );

      await expect(
        service.confirmStake('user-a', 'FORGED', context),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('releaseToWinner', () => {
    it('resolves the pot to the winner address', async () => {
      const result = await service.releaseToWinner('user-b', context);

      expect(escrow.resolve).toHaveBeenCalledWith(
        resolver,
        SESSION_ID,
        addressB,
      );
      expect(result.success).toBe(true);
      expect(result.newBalance).toBe('500000000');
    });

    it('does not resolve to a winner without a verified wallet', async () => {
      userRepository.findOne.mockResolvedValue(null);

      const result = await service.releaseToWinner('ghost', context);

      expect(escrow.resolve).not.toHaveBeenCalled();
      expect(result.status).toBe(SettlementStatus.FAILED);
    });

    it('pays the address the pot recorded, even if the winner unlinked or relinked since', async () => {
      // The pot staked addressB for user-b, but the account now points
      // somewhere else (or nowhere) — the payout must still go to addressB.
      const potAddress = Keypair.random().publicKey();
      escrow.getPot.mockResolvedValue({
        playerA: addressA,
        playerB: potAddress,
        stake: context.stake,
        fundedA: true,
        fundedB: true,
        status: PotStatus.FUNDED,
      });
      userRepository.findOne.mockResolvedValue(
        verifiedUser('user-b', addressB),
      );

      const result = await service.releaseToWinner('user-b', context);

      expect(escrow.resolve).toHaveBeenCalledWith(
        resolver,
        SESSION_ID,
        potAddress,
      );
      expect(result.success).toBe(true);
    });
  });

  describe('refundEscrow', () => {
    it('refunds the pot as a unit, without needing player addresses', async () => {
      const result = await service.refundEscrow(context);

      expect(escrow.refund).toHaveBeenCalledWith(resolver, SESSION_ID);
      expect(userRepository.findOne).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('unconfirmed submissions', () => {
    it('reports an unconfirmed submission as SUBMITTED, not FAILED', async () => {
      // FAILED would invite a retry that double-pays if the first one lands.
      escrow.openPot.mockResolvedValue(unconfirmed);

      const result = await service.openEscrow(context);

      expect(result).toMatchObject({
        success: false,
        status: SettlementStatus.SUBMITTED,
        txHash: 'hash-unconfirmed',
      });
      expect(result.message).toMatch(/awaiting reconciliation/);
    });

    it('keeps the transaction hash so the wager can be reconciled', async () => {
      escrow.resolve.mockResolvedValue(unconfirmed);

      const result = await service.releaseToWinner('user-b', context);

      expect(result.txHash).toBe('hash-unconfirmed');
    });

    it('distinguishes a thrown error (FAILED) from an unconfirmed one', async () => {
      escrow.refund.mockRejectedValue(new Error('simulation failed'));

      const result = await service.refundEscrow(context);

      expect(result.status).toBe(SettlementStatus.FAILED);
      expect(result.txHash).toBeUndefined();
    });
  });

  describe('balances', () => {
    it('reads the balance of the user verified address', async () => {
      expect(await service.getUserBalance('user-a')).toBe('500000000');
      expect(escrow.getTokenBalance).toHaveBeenCalledWith(addressA);
    });

    it('compares balances numerically, not lexicographically', async () => {
      escrow.getTokenBalance.mockResolvedValue('9');

      expect(await service.hasSufficientTokens('user-a', '10')).toBe(false);
    });

    it('accepts a balance exactly equal to the stake', async () => {
      escrow.getTokenBalance.mockResolvedValue('105000000');

      expect(await service.hasSufficientTokens('user-a', '105000000')).toBe(
        true,
      );
    });

    it('treats an unreadable balance as insufficient', async () => {
      // Failing open here would let an unfunded player into a wagered match.
      escrow.getTokenBalance.mockRejectedValue(new Error('rpc down'));

      expect(await service.hasSufficientTokens('user-a', '1')).toBe(false);
    });

    it('surfaces an unlinked wallet instead of reporting it as insufficient', async () => {
      // "Link a wallet" and "you cannot afford this" call for different things
      // from the player, so the first must not be flattened into the second.
      await expect(service.hasSufficientTokens('ghost', '1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('reports a balance it simply could not read as insufficient', async () => {
      escrow.getTokenBalance.mockRejectedValue(new Error('rpc unreachable'));

      expect(await service.hasSufficientTokens('user-a', '1')).toBe(false);
    });
  });

  describe('reconcile', () => {
    it('confirms when the submission itself is now confirmed', async () => {
      rpc.lookupTransaction.mockResolvedValue(confirmed);

      const result = await service.reconcile('hash-confirmed', context);

      expect(result).toMatchObject({
        success: true,
        status: SettlementStatus.CONFIRMED,
      });
    });

    it('treats an already-resolved pot as settled even if the receipt was lost', async () => {
      escrow.getPot.mockResolvedValue({
        playerA: addressA,
        playerB: addressB,
        stake: '105000000',
        fundedA: true,
        fundedB: true,
        status: PotStatus.RESOLVED,
      });

      const result = await service.reconcile('hash-unconfirmed', context);

      expect(result).toMatchObject({
        success: true,
        status: SettlementStatus.CONFIRMED,
        txHash: 'hash-unconfirmed',
      });
      expect(result.message).toMatch(/already resolved on-chain/);
    });

    it('treats an already-refunded pot as settled', async () => {
      escrow.getPot.mockResolvedValue({
        playerA: addressA,
        playerB: addressB,
        stake: '105000000',
        fundedA: true,
        fundedB: false,
        status: PotStatus.REFUNDED,
      });

      const result = await service.reconcile('hash-unconfirmed', context);

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/already refunded on-chain/);
    });

    it('stays unsettled while the pot is merely funded', async () => {
      // Funded means the stakes are in but nothing has paid out; claiming
      // settlement here would strand the pot.
      escrow.getPot.mockResolvedValue({
        playerA: addressA,
        playerB: addressB,
        stake: '105000000',
        fundedA: true,
        fundedB: true,
        status: PotStatus.FUNDED,
      });

      const result = await service.reconcile('hash-unconfirmed', context);

      expect(result).toMatchObject({
        success: false,
        status: SettlementStatus.SUBMITTED,
      });
    });

    it('stays unsettled when the pot cannot be read at all', async () => {
      escrow.getPot.mockResolvedValue(null);

      const result = await service.reconcile('hash-unconfirmed', context);

      expect(result.success).toBe(false);
      expect(result.status).toBe(SettlementStatus.SUBMITTED);
    });

    it('checks the submission and the pot together', async () => {
      await service.reconcile('hash-unconfirmed', context);

      expect(rpc.lookupTransaction).toHaveBeenCalledWith('hash-unconfirmed');
      expect(escrow.getPot).toHaveBeenCalledWith(SESSION_ID);
    });
  });
});
