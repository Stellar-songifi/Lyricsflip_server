import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Genre } from 'src/lyrics/entities/genre.enum';
import { RandomLyricOptionsDto } from './random-lyrics-option.dto';

async function check(query: object) {
  const dto = plainToInstance(RandomLyricOptionsDto, query);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('RandomLyricOptionsDto', () => {
  it('accepts a valid genre', async () => {
    const { dto, errors } = await check({ genre: 'Pop' });
    expect(errors).toHaveLength(0);
    expect(dto.genre).toBe(Genre.Pop);
  });

  it('normalises genre case to the enum value', async () => {
    const { dto, errors } = await check({ genre: ' hip-hop ' });
    expect(errors).toHaveLength(0);
    expect(dto.genre).toBe(Genre.HipHop);
  });

  it('rejects an unknown genre', async () => {
    const { errors } = await check({ genre: 'Polka' });
    expect(errors.map((e) => e.property)).toContain('genre');
  });

  it('allows omitting genre', async () => {
    const { errors } = await check({});
    expect(errors).toHaveLength(0);
  });

  // --- ignorePreferences (issue #176) ---

  it('accepts ignorePreferences=true as a string (query-param style)', async () => {
    const { dto, errors } = await check({ ignorePreferences: 'true' });
    expect(errors).toHaveLength(0);
    expect(dto.ignorePreferences).toBe(true);
  });

  it('accepts ignorePreferences=false as a string', async () => {
    const { dto, errors } = await check({ ignorePreferences: 'false' });
    expect(errors).toHaveLength(0);
    expect(dto.ignorePreferences).toBe(false);
  });

  it('accepts ignorePreferences as a boolean', async () => {
    const { dto, errors } = await check({ ignorePreferences: true });
    expect(errors).toHaveLength(0);
    expect(dto.ignorePreferences).toBe(true);
  });

  it('allows omitting ignorePreferences', async () => {
    const { dto, errors } = await check({});
    expect(errors).toHaveLength(0);
    expect(dto.ignorePreferences).toBeUndefined();
  });

  // --- difficulty (issue #175) ---

  it('accepts a valid difficulty in range 1–5', async () => {
    for (const d of [1, 2, 3, 4, 5]) {
      const { dto, errors } = await check({ difficulty: d });
      expect(errors).toHaveLength(0);
      expect(dto.difficulty).toBe(d);
    }
  });

  it('coerces a numeric string to a number for difficulty', async () => {
    const { dto, errors } = await check({ difficulty: '3' });
    expect(errors).toHaveLength(0);
    expect(dto.difficulty).toBe(3);
  });

  it('rejects difficulty 0 (below 1–5 range)', async () => {
    const { errors } = await check({ difficulty: 0 });
    expect(errors.map((e) => e.property)).toContain('difficulty');
  });

  it('rejects difficulty 6 (above 1–5 range)', async () => {
    const { errors } = await check({ difficulty: 6 });
    expect(errors.map((e) => e.property)).toContain('difficulty');
  });

  it('allows omitting difficulty', async () => {
    const { dto, errors } = await check({});
    expect(errors).toHaveLength(0);
    expect(dto.difficulty).toBeUndefined();
  });
});
