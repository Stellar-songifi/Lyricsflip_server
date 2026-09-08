import { Test, TestingModule } from '@nestjs/testing';
import { GameSessionsController } from './game-sessions.controller';
import { GameSessionsService } from './game-sessions.service';
import { User } from '../users/entities/user.entity';

describe('GameSessionsController', () => {
  let controller: GameSessionsController;
  let service: jest.Mocked<
    Pick<
      GameSessionsService,
      'create' | 'confirmStake' | 'reconcileWager' | 'getUserTokenBalance'
    >
  >;

  const user = { id: 'user-1', username: 'ada' } as User;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      confirmStake: jest.fn(),
      reconcileWager: jest.fn(),
      getUserTokenBalance: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GameSessionsController],
      providers: [{ provide: GameSessionsService, useValue: service }],
    }).compile();

    controller = module.get<GameSessionsController>(GameSessionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('creating a wagered session', () => {
    it('passes the transactions to sign through to the caller', async () => {
      const pendingSignatures = [
        { userId: 'user-1', transaction: { xdr: 'AAAA...' } },
      ];
      service.create.mockResolvedValue({
        id: 'session-1',
        pendingSignatures,
      } as never);

      const result = await controller.create({ hasWager: true } as never, user);

      expect(result).toMatchObject({ pendingSignatures });
    });
  });

  describe('confirmStake', () => {
    it('submits the signed stake on behalf of the authenticated player', async () => {
      const wagerResult = { success: true, message: 'Stake confirmed.' };
      service.confirmStake.mockResolvedValue(wagerResult as never);

      await expect(
        controller.confirmStake('session-1', user, { transaction: 'signed' }),
      ).resolves.toEqual(wagerResult);

      // The player is taken from the token, never from the request body: the
      // caller must not be able to confirm a stake as somebody else.
      expect(service.confirmStake).toHaveBeenCalledWith(
        'session-1',
        'user-1',
        'signed',
      );
    });

    it('surfaces a rejection from the wager service', async () => {
      const failure = new Error('You are not a player in this wager');
      service.confirmStake.mockRejectedValue(failure);

      await expect(
        controller.confirmStake('session-1', user, { transaction: 'signed' }),
      ).rejects.toThrow(failure);
    });
  });

  describe('reconcileWager', () => {
    it('reconciles the wager for a session', async () => {
      const wagerResult = { success: true, message: 'Nothing to reconcile' };
      service.reconcileWager.mockResolvedValue(wagerResult as never);

      await expect(controller.reconcileWager('session-1')).resolves.toEqual(
        wagerResult,
      );
      expect(service.reconcileWager).toHaveBeenCalledWith('session-1');
    });
  });
});
