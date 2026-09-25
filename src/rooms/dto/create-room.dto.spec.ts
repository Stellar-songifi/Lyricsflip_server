import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRoomDto } from './create-room.dto';

async function check(body: object) {
  const dto = plainToInstance(CreateRoomDto, body);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('CreateRoomDto', () => {
  it('accepts an integer lyricId', async () => {
    const { dto, errors } = await check({ lyricId: 3 });
    expect(errors).toHaveLength(0);
    expect(dto.lyricId).toBe(3);
  });

  it('coerces a numeric string lyricId to a number', async () => {
    const { dto, errors } = await check({ lyricId: '3' });
    expect(errors).toHaveLength(0);
    expect(dto.lyricId).toBe(3);
  });

  it('allows omitting lyricId', async () => {
    const { errors } = await check({ name: 'Room' });
    expect(errors).toHaveLength(0);
  });

  it.each([
    ['a UUID', '123e4567-e89b-12d3-a456-426614174000'],
    ['a decimal', 3.5],
    ['zero', 0],
    ['a negative number', -1],
    ['a word', 'abc'],
  ])('rejects %s', async (_label, lyricId) => {
    const { errors } = await check({ lyricId });
    expect(errors.map((e) => e.property)).toContain('lyricId');
  });
});
