import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Repository } from 'typeorm';
import { GameHistoryService } from './game-history.service';
import { GameHistoryController } from './game-history.controller';
import { GameHistory } from './entities/game-history.entity';
import { User } from '../users/entities/user.entity';
import { Role } from '../auth/roles/role.enum';
import { ROLES_KEY } from '../auth/roles/roles.decorator';

describe('Game history authorization', () => {
  const owner = { id: 'owner-1', role: Role.User } as User;
  const stranger = { id: 'stranger-1', role: Role.User } as User;
  const admin = { id: 'admin-1', role: Role.Admin } as User;

  const record = {
    id: 'history-1',
    playerId: owner.id,
    player: { id: owner.id, passwordHash: 'hash' },
    lyricId: 7,
    lyric: {
      artist: 'Artist',
      songTitle: 'Song',
      lyricSnippet: 'snippet',
      createdBy: { id: 'admin-1', passwordHash: 'hash' },
    },
    gameSession: null,
    guessType: 'artist',
    guessValue: 'Artist',
    isCorrect: true,
    pointsAwarded: 100,
    xpChange: 10,
    createdAt: new Date(),
  } as unknown as GameHistory;

  let repository: jest.Mocked<Pick<Repository<GameHistory>, 'findOne'>>;
  let service: GameHistoryService;

  beforeEach(() => {
    repository = { findOne: jest.fn().mockResolvedValue(record) };
    service = new GameHistoryService(
      repository as unknown as Repository<GameHistory>,
    );
  });

  describe('findOne', () => {
    it('lets the player read their own record', async () => {
      await expect(service.findOne('history-1', owner)).resolves.toMatchObject({
        id: 'history-1',
      });
    });

    it('lets an admin read any record', async () => {
      await expect(service.findOne('history-1', admin)).resolves.toMatchObject({
        id: 'history-1',
      });
    });

    it("rejects another user's record", async () => {
      await expect(service.findOne('history-1', stranger)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('reports a missing record as not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing', owner)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('does not load or return any user entity', async () => {
      const result = await service.findOne('history-1', owner);

      expect(repository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ relations: ['lyric', 'gameSession'] }),
      );
      expect(result).not.toHaveProperty('player');
      expect(result.lyric).not.toHaveProperty('createdBy');
      expect(JSON.stringify(result)).not.toContain('passwordHash');
    });
  });

  it('restricts GET /game-history/users/:userId to admins', () => {
    const roles = new Reflector().get<Role[]>(
      ROLES_KEY,
      GameHistoryController.prototype.getUserHistory,
    );

    expect(roles).toEqual([Role.Admin]);
  });
});
