/**
 * Seed script — run with:  npm run seed
 *
 * Reads SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD from the environment.
 * Refuses to run when NODE_ENV=production unless both variables are set.
 *
 * Connects via a slim TypeORM DataSource (no full NestJS app boot, no
 * Stellar config, no cache layer).
 *
 * Idempotent: keyed on the (artist, songTitle) unique constraint — safe to
 * run multiple times on the same database.
 */

import 'reflect-metadata';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';

// Load .env from project root so env vars are available when running via
// ts-node without a running NestJS process.
config({ path: path.resolve(__dirname, '../../.env') });

import { User } from '../users/entities/user.entity';
import { Lyrics, Genre } from '../lyrics/entities/lyrics.entity';
import { Role } from '../auth/roles/role.enum';
import {
  buildDataSourceOptions,
  envFromRecord,
} from '../config/database.config';

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-var-requires
const seedData: Array<{
  artist: string;
  songTitle: string;
  genre: string;
  decade: string;
  difficulty: number;
  content: string;
  lyricSnippet: string;
}> = require('./seed-data.json');

// ---------------------------------------------------------------------------
// Guard: refuse to run in production without explicit credentials
// ---------------------------------------------------------------------------
function resolveCredentials(): { email: string; password: string } {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (process.env.NODE_ENV === 'production') {
    if (!email || !password) {
      console.error(
        'ERROR: SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set ' +
          'when running the seed in production.',
      );
      process.exit(1);
    }
  }

  return {
    email: email ?? 'admin@lyricflip.local',
    password: password ?? 'changeme_local_seed',
  };
}

// ---------------------------------------------------------------------------
// Slim DataSource — only the entities and connection we actually need
// ---------------------------------------------------------------------------
function buildDataSource(): DataSource {
  try {
    return new DataSource({
      ...buildDataSourceOptions(envFromRecord(process.env), {
        entities: [User, Lyrics],
      }),
      logging: false,
    });
  } catch (error) {
    console.error(`ERROR: ${(error as Error).message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Map genre string from fixture to the Genre enum
// ---------------------------------------------------------------------------
function toGenre(raw: string): Genre {
  const map: Record<string, Genre> = {
    Afrobeats: Genre.Afrobeats,
    'Hip-Hop': Genre.HipHop,
    Pop: Genre.Pop,
    Other: Genre.Other,
  };
  return map[raw] ?? Genre.Other;
}

// ---------------------------------------------------------------------------
// Main bootstrap
// ---------------------------------------------------------------------------
export async function bootstrap() {
  const { email, password } = resolveCredentials();
  const dataSource = buildDataSource();

  await dataSource.initialize();

  const userRepo = dataSource.getRepository(User);
  const lyricsRepo = dataSource.getRepository(Lyrics);

  // ------------------------------------------------------------------
  // 1. Upsert admin user
  // ------------------------------------------------------------------
  let admin = await userRepo.findOne({ where: { email } });
  if (!admin) {
    const hashedPassword = await bcrypt.hash(password, 12);
    admin = userRepo.create({
      email,
      username: 'seedadmin',
      name: 'Seed Admin',
      passwordHash: hashedPassword,
      role: Role.Admin,
    });
    admin = await userRepo.save(admin);
    console.log(`Created admin user: ${email}`);
  } else {
    // Ensure role is set even if the row already existed without it
    if (admin.role !== Role.Admin) {
      admin.role = Role.Admin;
      await userRepo.save(admin);
      console.log(`Updated existing user to admin role: ${email}`);
    } else {
      console.log(`Admin user already exists: ${email}`);
    }
  }

  // ------------------------------------------------------------------
  // 2. Upsert lyrics — keyed on (artist, songTitle) unique constraint
  // ------------------------------------------------------------------
  let created = 0;
  let skipped = 0;

  for (const entry of seedData) {
    const exists = await lyricsRepo.findOne({
      where: { artist: entry.artist, songTitle: entry.songTitle },
    });

    if (exists) {
      skipped++;
      continue;
    }

    await lyricsRepo.save(
      lyricsRepo.create({
        content: entry.content,
        lyricSnippet: entry.lyricSnippet,
        songTitle: entry.songTitle,
        artist: entry.artist,
        genre: toGenre(entry.genre),
        decade: entry.decade,
        difficulty: entry.difficulty,
        createdBy: { id: admin.id },
      }),
    );
    created++;
  }

  console.log(
    `Lyrics: ${created} created, ${skipped} already present (${seedData.length} total).`,
  );
  console.log('Seeding complete.');

  await dataSource.destroy();
}

// Only execute when invoked directly (npm run seed), not when imported by specs.
if (require.main === module) {
  bootstrap().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
