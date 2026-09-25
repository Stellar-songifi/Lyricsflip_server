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
});
