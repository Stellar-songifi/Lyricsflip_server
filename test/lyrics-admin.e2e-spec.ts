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
import { AdminController } from '../src/admin/admin.controller';
import { AdminService } from '../src/admin/admin.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { Role } from '../src/auth/roles/role.enum';

describe('Lyrics admin writes (e2e)', () => {
  let app: INestApplication<App>;
  let createSpy: jest.SpyInstance;
  let updateSpy: jest.SpyInstance;
  let findByArtistSpy: jest.SpyInstance;
  let findExistingKeysSpy: jest.SpyInstance;
  let bulkUpsertSpy: jest.SpyInstance;
  let removeSpy: jest.SpyInstance;
  let restoreSpy: jest.SpyInstance;
  let deactivateBySourceSpy: jest.SpyInstance;

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
    find: jest.fn(() => Promise.resolve([{ ...stored }])),
    findAndCount: jest.fn(() => Promise.resolve([[{ ...stored }], 1])),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
    delete: jest.fn(() => Promise.resolve({ affected: 1 })),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(() => Promise.resolve([[{ ...stored }], 1])),
      getMany: jest.fn(() => Promise.resolve([{ ...stored }])),
      getOne: jest.fn(() => Promise.resolve({ ...stored })),
    })),
    manager: {
      transaction: jest.fn((cb: (m: unknown) => unknown) =>
        Promise.resolve(cb({ save: repository.save })),
      ),
    },
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
      controllers: [LyricsController, AdminController],
      providers: [
        LyricsService,
        AdminService,
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
    findByArtistSpy = jest.spyOn(service, 'findByArtist');
    findExistingKeysSpy = jest.spyOn(service, 'findExistingKeys');
    bulkUpsertSpy = jest.spyOn(service, 'bulkUpsert');
    removeSpy = jest.spyOn(service, 'remove');
    restoreSpy = jest.spyOn(service, 'restore');
    deactivateBySourceSpy = jest.spyOn(service, 'deactivateBySource');
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

  describe('AdminController lyric routes', () => {
    it('GET /admin/lyrics returns a non-500 response', async () => {
      const res = await request(app.getHttpServer()).get('/admin/lyrics');

      expect(res.status).toBeLessThan(500);
    });

    it('POST /admin/lyrics/import returns a non-500 response', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/lyrics/import')
        .send({
          lyrics: [
            {
              content: 'Imported content',
              artist: 'Imported Artist',
              songTitle: 'Imported Title',
              genre: Genre.Pop,
              decade: 2000,
            },
          ],
        });

      expect(res.status).toBeLessThan(500);
    });

    it('DELETE /admin/lyrics/:id returns a non-500 response', async () => {
      const res = await request(app.getHttpServer()).delete(
        '/admin/lyrics/7',
      );

      expect(res.status).toBeLessThan(500);
    });

    it('POST /admin/lyrics/:id/restore returns a non-500 response', async () => {
      const res = await request(app.getHttpServer()).post(
        '/admin/lyrics/7/restore',
      );

      expect(res.status).toBeLessThan(500);
    });

    it('POST /admin/lyrics/deactivate-by-source returns a non-500 response', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/lyrics/deactivate-by-source')
        .send({ source: 'import' });

      expect(res.status).toBeLessThan(500);
    });
  });
});
