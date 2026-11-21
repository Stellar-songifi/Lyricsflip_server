import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import * as request from 'supertest';
import { LyricsController } from '../src/lyrics/lyrics.controller';
import { LyricsService } from '../src/lyrics/lyrics.service';
import { Lyrics } from '../src/lyrics/entities/lyrics.entity';

describe('Lyrics (e2e)', () => {
  let app: INestApplication;
  let findOneSpy: jest.SpyInstance;

  const lyric = {
    id: 3,
    content: 'Full lyric',
    lyricSnippet: 'Snippet',
    artist: 'Artist',
    songTitle: 'Title',
    genre: 'pop',
    releaseYear: 1999,
    isActive: true,
  };

  const repository = {
    findOne: jest.fn(async ({ where }: { where: { id: number } }) =>
      where.id === lyric.id ? lyric : null,
    ),
    find: jest.fn(async () => [lyric]),
    create: jest.fn((data: Partial<Lyrics>) => ({ ...lyric, ...data })),
    save: jest.fn(async (data: Partial<Lyrics>) => ({ ...lyric, ...data })),
    update: jest.fn(async () => ({ affected: 1 })),
    remove: jest.fn(async () => undefined),
    createQueryBuilder: jest.fn(() => {
      const qb: any = {};
      for (const m of [
        'leftJoinAndSelect',
        'where',
        'andWhere',
        'orderBy',
        'addOrderBy',
        'limit',
        'offset',
        'skip',
        'take',
        'select',
        'groupBy',
        'addGroupBy',
        'having',
      ]) {
        qb[m] = () => qb;
      }
      qb.getCount = async () => 1;
      qb.getMany = async () => [lyric];
      qb.getManyAndCount = async () => [[lyric], 1];
      qb.getOne = async () => lyric;
      qb.getRawMany = async () => [{ genre: 'pop', count: '1' }];
      return qb;
    }),
  };

  const cache = {
    get: jest.fn(async () => undefined),
    set: jest.fn(async () => undefined),
    del: jest.fn(async () => undefined),
    reset: jest.fn(async () => undefined),
    store: { keys: jest.fn(async () => []) },
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
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

  describe('every route returns a non-500 response', () => {
    const routes: Array<{ method: 'get' | 'post' | 'patch' | 'delete'; path: string; body?: any }> = [
      { method: 'get', path: '/lyrics' },
      { method: 'get', path: '/lyrics/3' },
      { method: 'get', path: '/lyrics/random' },
      { method: 'get', path: '/lyrics/genre/pop' },
      { method: 'get', path: '/lyrics/decade/1990' },
      { method: 'get', path: '/lyrics/artist/Artist' },
      { method: 'get', path: '/lyrics/search?q=lyric' },
      {
        method: 'post',
        path: '/lyrics',
        body: {
          content: 'New lyric',
          lyricSnippet: 'New snippet',
          artist: 'Artist',
          songTitle: 'Title',
          genre: 'pop',
        },
      },
      { method: 'patch', path: '/lyrics/3', body: { content: 'Updated lyric' } },
      { method: 'delete', path: '/lyrics/3' },
    ];

    it.each(routes)('$method $path', async ({ method, path, body }) => {
      const req = (request(app.getHttpServer()) as any)[method](path);
      const res = body ? await req.send(body) : await req;

      expect(res.status).toBeLessThan(500);
    });
  });
});
