import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import * as request from 'supertest';
import { LyricsController } from '../src/lyrics/lyrics.controller';
import { LyricsService } from '../src/lyrics/lyrics.service';
import { Lyrics } from '../src/lyrics/entities/lyrics.entity';

describe('Lyrics by ID (e2e)', () => {
  let app: INestApplication;
  let findOneSpy: jest.SpyInstance;

  const lyric = {
    id: 3,
    content: 'Full lyric',
    lyricSnippet: 'Snippet',
    artist: 'Artist',
    songTitle: 'Title',
    isActive: true,
  };

  const repository = {
    findOne: jest.fn(async ({ where }: { where: { id: number } }) =>
      where.id === lyric.id ? lyric : null,
    ),
    createQueryBuilder: jest.fn(() => {
      const qb: any = {};
      for (const m of ['leftJoinAndSelect', 'where', 'andWhere', 'orderBy', 'limit']) {
        qb[m] = () => qb;
      }
      qb.getCount = async () => 1;
      qb.getMany = async () => [lyric];
      return qb;
    }),
  };

  const cache = {
    get: jest.fn(async () => undefined),
    set: jest.fn(async () => undefined),
    del: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [LyricsController],
      providers: [
        LyricsService,
        { provide: getRepositoryToken(Lyrics), useValue: repository },
        { provide: CACHE_MANAGER, useValue: cache },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    findOneSpy = jest.spyOn(app.get(LyricsService), 'findOne');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /lyrics/abc returns 400 without reaching the service', async () => {
    await request(app.getHttpServer()).get('/lyrics/abc').expect(400);

    expect(findOneSpy).not.toHaveBeenCalled();
    expect(repository.findOne).not.toHaveBeenCalled();
  });

  it('GET /lyrics/999999 returns 404', async () => {
    await request(app.getHttpServer()).get('/lyrics/999999').expect(404);
  });

  it('GET /lyrics/3 passes the ID to the service as a number', async () => {
    const res = await request(app.getHttpServer()).get('/lyrics/3').expect(200);

    expect(res.body.id).toBe(3);
    expect(findOneSpy).toHaveBeenCalledWith(3);
    expect(cache.get).toHaveBeenCalledWith('lyrics:3');
  });

  it('literal routes such as /lyrics/random are not shadowed by :id', async () => {
    const res = await request(app.getHttpServer())
      .get('/lyrics/random')
      .expect(200);

    expect(res.body).toEqual([expect.objectContaining({ id: 3 })]);
    expect(findOneSpy).not.toHaveBeenCalled();
  });
});
