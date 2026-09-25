import { Test, TestingModule } from '@nestjs/testing';
import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CompleteWageredGameDto } from './dto/complete-wagered-game.dto';
import { UpdateGameSessionDto } from './dto/update-game-session.dto';
import { Role } from '../auth/roles/role.enum';
import { ROLES_KEY } from '../auth/roles/roles.decorator';
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

  describe('complete-wagered', () => {
    // The same options main.ts registers globally.
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const bodyOf = (metatype: unknown): ArgumentMetadata => ({
      type: 'body',
      metatype: metatype as ArgumentMetadata['metatype'],
    });

    it('is admin only, so a player gets 403', () => {
      const roles = new Reflector().get<Role[]>(
        ROLES_KEY,
        GameSessionsController.prototype.completeWageredGame,
      );

      expect(roles).toEqual([Role.Admin]);
    });

    it.each([
      ['a negative score', { playerOneScore: -1, playerTwoScore: 0 }],
      ['a fractional score', { playerOneScore: 1.5, playerTwoScore: 0 }],
      ['a string score', { playerOneScore: '10', playerTwoScore: 0 }],
      ['a missing score', { playerOneScore: 10 }],
    ])('rejects %s with 400', async (_, body) => {
      await expect(
        pipe.transform(body, bodyOf(CompleteWageredGameDto)),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts non-negative integer scores', async () => {
      await expect(
        pipe.transform(
          { playerOneScore: 3, playerTwoScore: 0 },
          bodyOf(CompleteWageredGameDto),
        ),
      ).resolves.toBeInstanceOf(CompleteWageredGameDto);
    });
  });

  describe('PATCH /game-sessions/:id', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });

    it.each([
      'score',
      'status',
      'mode',
      'hasWager',
      'wagerAmount',
      'playerTwoId',
    ])('rejects a client setting %s', async (field) => {
      await expect(
        pipe.transform(
          { [field]: 'x' },
          { type: 'body', metatype: UpdateGameSessionDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
