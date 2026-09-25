import { Reflector } from '@nestjs/core';
import { LyricsController } from './lyrics.controller';
import type { LyricsService } from './lyrics.service';
import { Genre, Lyrics } from './entities/lyrics.entity';
import type { User } from '../users/entities/user.entity';
import { Role } from '../auth/roles/role.enum';
import { ROLES_KEY } from '../auth/roles/roles.decorator';

describe('LyricsController', () => {
  const lyric = {
    id: 1,
    content: 'Full lyric content',
    artist: 'Secret Artist',
    lyricSnippet: 'a line from the song',
    songTitle: 'Secret Song',
    category: 'Pop',
    genre: Genre.Pop,
    decade: '2010',
    difficulty: 2,
    isActive: true,
    timesUsed: 0,
    createdBy: { id: 'admin-1', passwordHash: 'hash' } as unknown as User,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Lyrics;

  const player = { id: 'player-1', role: Role.User } as User;
  const admin = { id: 'admin-1', role: Role.Admin } as User;

  let service: jest.Mocked<
    Pick<
      LyricsService,
      'findAll' | 'findOne' | 'getRandomLyrics' | 'getLyricsByCategory'
    >
  >;
  let controller: LyricsController;

  beforeEach(() => {
    service = {
      findAll: jest.fn().mockResolvedValue([lyric]),
      findOne: jest.fn().mockResolvedValue(lyric),
      getRandomLyrics: jest.fn().mockResolvedValue([lyric]),
      getLyricsByCategory: jest.fn().mockResolvedValue([lyric]),
    };
    controller = new LyricsController(service as unknown as LyricsService);
  });

  const expectNoAnswer = (result: object) => {
    expect(result).toEqual({
      id: 1,
      lyricSnippet: 'a line from the song',
      genre: Genre.Pop,
      decade: '2010',
      category: 'Pop',
    });
  };

  describe('a player cannot obtain the answer to a lyric', () => {
    it('from GET /lyrics/:id', async () => {
      expectNoAnswer(await controller.findOne(1, player));
    });

    it('from GET /lyrics', async () => {
      const [result] = await controller.findAll(player);
      expectNoAnswer(result);
    });

    it('from GET /lyrics/random', async () => {
      const [result] = await controller.getRandomLyrics(player);
      expectNoAnswer(result);
    });

    it('from GET /lyrics/genre/:genre', async () => {
      const [result] = await controller.getLyricsByGenre('Pop', player);
      expectNoAnswer(result);
    });

    it('from GET /lyrics/decade/:decade', async () => {
      const [result] = await controller.getLyricsByDecade('2010', player);
      expectNoAnswer(result);
    });

    it('because GET /lyrics/artist/:artist is admin only', () => {
      const roles = new Reflector().get<Role[]>(
        ROLES_KEY,
        LyricsController.prototype.getLyricsByArtist,
      );
      expect(roles).toEqual([Role.Admin]);
    });
  });

  it('gives admins the answer, without the creator record', async () => {
    const result = await controller.findOne(1, admin);

    expect(result).toMatchObject({
      artist: 'Secret Artist',
      songTitle: 'Secret Song',
      content: 'Full lyric content',
    });
    expect(result).not.toHaveProperty('createdBy');
  });
});
