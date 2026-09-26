import { Test } from '@nestjs/testing';
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { LyricsController } from '../src/lyrics/lyrics.controller';
import { LyricsService } from '../src/lyrics/lyrics.service';
import { Genre, Lyrics } from '../src/lyrics/entities/lyrics.entity';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { Role } from '../src/auth/roles/role.enum';

describe('Lyrics admin writes (e2e)', () => {
  let app: INestApplication<App>;
  let createSpy: jest.SpyInstance;
  let updateSpy: jest.SpyInstance;

  const admin = { id: 'admin-1', role: Role.Admin };

  const stored: Partial<Lyrics> = {
    id: 7,
    content: 'Old content',
    lyricSnippet: 'Old snippet',
    artist: 'Old Artist',
    songTitle: 'Old Title',
    genre: Genre.Pop,
    decade: '2000',
    isActive: true,
  };

  const repository = {
    create: jest.fn((data: Partial<Lyrics>) => ({ ...data })),
    save: jest.fn((data: Partial<Lyrics>) =>
      Promise.resolve({ id: 1, ...data }),
    ),
    findOne: jest.fn(() => Promise.resolve({ ...stored })),
  };

  const cache = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };

  const validLyric = {
    content: 'Full lyric content',
    artist: 'Artist',
    songTitle: 'Title',
    genre: Genre.Afrobeats,
    decade: 2010,
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LyricsController],
      providers: [
        LyricsService,
        { provide: getRepositoryToken(Lyrics), useValue: repository },
        { provide: CACHE_MANAGER, useValue: cache },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest<{ user: unknown }>().user = admin;
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    // Same options as the global pipe in main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    const service = app.get(LyricsService);
    createSpy = jest.spyOn(service, 'create');
    updateSpy = jest.spyOn(service, 'update');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /lyrics', () => {
    it('passes the body to the service and persists the submitted fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/lyrics')
        .send(validLyric)
        .expect(201);

      expect(createSpy).toHaveBeenCalledWith(validLyric, admin);
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ ...validLyric, decade: '2010' }),
      );
      expect(res.body).toMatchObject({ ...validLyric, decade: '2010' });
      expect(res.body).not.toHaveProperty('createdBy');
    });

    it('returns 400 for an invalid genre', async () => {
      const res = await request(app.getHttpServer())
        .post('/lyrics')
        .send({ ...validLyric, genre: 'Jazz' })
        .expect(400);

      expect((res.body as { message: string[] }).message).toEqual(
        expect.arrayContaining([expect.stringContaining('genre')]),
      );
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/lyrics')
        .send({ genre: Genre.Pop })
        .expect(400);

      expect((res.body as { message: string[] }).message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('content'),
          expect.stringContaining('artist'),
          expect.stringContaining('songTitle'),
          expect.stringContaining('decade'),
        ]),
      );
      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /lyrics/:id', () => {
    it('updates only the provided fields', async () => {
      const res = await request(app.getHttpServer())
        .patch('/lyrics/7')
        .send({ artist: 'New Artist' })
        .expect(200);

      expect(updateSpy).toHaveBeenCalledWith(
        7,
        { artist: 'New Artist' },
        admin,
      );
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ ...stored, artist: 'New Artist' }),
      );
      expect(res.body).toMatchObject({
        id: 7,
        artist: 'New Artist',
        songTitle: 'Old Title',
        content: 'Old content',
      });
    });

    it('returns 400 for an invalid genre', async () => {
      const res = await request(app.getHttpServer())
        .patch('/lyrics/7')
        .send({ genre: 'Jazz' })
        .expect(400);

      expect((res.body as { message: string[] }).message).toEqual(
        expect.arrayContaining([expect.stringContaining('genre')]),
      );
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });
});
