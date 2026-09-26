import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SignupDto } from './signup.dto';

async function validateSignup(payload: Record<string, unknown>) {
  const dto = plainToInstance(SignupDto, payload);
  return validate(dto);
}

describe('SignupDto', () => {
  it('accepts a valid signup payload', async () => {
    const errors = await validateSignup({
      username: 'alice_01',
      email: 'Alice@Example.com',
      password: 'Str0ngPass',
    });
    expect(errors).toHaveLength(0);
  });

  it('normalizes email to lowercase and trimmed', () => {
    const dto = plainToInstance(SignupDto, {
      username: 'alice',
      email: '  Alice@Example.com  ',
      password: 'Str0ngPass',
    });
    expect(dto.email).toBe('alice@example.com');
  });

  it('trims the username', () => {
    const dto = plainToInstance(SignupDto, {
      username: '  alice  ',
      email: 'a@b.com',
      password: 'Str0ngPass',
    });
    expect(dto.username).toBe('alice');
  });

  it('rejects passwords shorter than 8 characters', async () => {
    const errors = await validateSignup({
      username: 'alice',
      email: 'a@b.com',
      password: 'Ab1',
    });
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('rejects passwords without the required character classes', async () => {
    const errors = await validateSignup({
      username: 'alice',
      email: 'a@b.com',
      password: 'alllowercase1',
    });
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('rejects usernames with disallowed characters', async () => {
    const errors = await validateSignup({
      username: 'alice 👽',
      email: 'a@b.com',
      password: 'Str0ngPass',
    });
    expect(errors.some((e) => e.property === 'username')).toBe(true);
  });

  it('rejects usernames outside the length bounds', async () => {
    const errors = await validateSignup({
      username: 'ab',
      email: 'a@b.com',
      password: 'Str0ngPass',
    });
    expect(errors.some((e) => e.property === 'username')).toBe(true);
  });
});
