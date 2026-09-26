import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import {
  AuthTokenService,
  INACTIVE_USER_MESSAGE,
} from './services/auth-token.service';
import { Role } from './roles/role.enum';
import { User } from '../users/entities/user.entity';

describe('AuthService login and signup', () => {
  const password = 'CorrectHorse1!';
  let passwordHash: string;

  let jwtService: { sign: jest.Mock };
  let tokens: AuthTokenService;
  let queryBuilder: {
    addSelect: jest.Mock;
    where: jest.Mock;
    getOne: jest.Mock;
  };
  let userRepository: {
    createQueryBuilder: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let service: AuthService;

  const storedUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'user-1',
      email: 'player@example.com',
      username: 'player',
      role: Role.User,
      isActive: true,
      passwordHash,
      ...overrides,
    }) as User;

  beforeAll(async () => {
    // Low cost factor: these tests exercise the flow, not bcrypt itself
    passwordHash = await bcrypt.hash(password, 4);
  });

  beforeEach(() => {
    jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    tokens = new AuthTokenService(jwtService as unknown as JwtService);

    queryBuilder = {
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(storedUser()),
    };
    userRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: Partial<User>) => ({ id: 'new-user', ...data })),
      save: jest.fn((user: User) => Promise.resolve(user)),
    };

    service = new AuthService(
      userRepository as unknown as Repository<User>,
      tokens,
    );
  });

  describe('login', () => {
    const login = (pw = password) =>
      service.login({ email: 'player@example.com', password: pw });

    it('loads the password hash explicitly, since it is select: false', async () => {
      await login();

      expect(queryBuilder.addSelect).toHaveBeenCalledWith('user.passwordHash');
      expect(queryBuilder.where).toHaveBeenCalledWith('user.email = :email', {
        email: 'player@example.com',
      });
    });

    it('signs exactly one token and returns it', async () => {
      const result = await login();

      expect(jwtService.sign).toHaveBeenCalledTimes(1);
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'user-1',
        email: 'player@example.com',
        username: 'player',
        role: Role.User,
      });
      expect(result.accessToken).toBe('signed.jwt.token');
    });

    it('never returns the password hash', async () => {
      const result = await login();

      expect(result.user).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(result)).not.toContain(passwordHash);
    });

    it('rejects a deactivated user with the wallet flow’s message', async () => {
      queryBuilder.getOne.mockResolvedValue(storedUser({ isActive: false }));

      await expect(login()).rejects.toThrow(
        new UnauthorizedException(INACTIVE_USER_MESSAGE),
      );
      expect(jwtService.sign).not.toHaveBeenCalled();
      // A refused login must not count as a login
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('does not reveal that an account is inactive without the right password', async () => {
      queryBuilder.getOne.mockResolvedValue(storedUser({ isActive: false }));

      await expect(login('wrong-password')).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
    });

    it('rejects an unknown email', async () => {
      queryBuilder.getOne.mockResolvedValue(null);

      await expect(login()).rejects.toThrow('Invalid credentials');
    });
  });

  describe('signup', () => {
    it('issues its token through the shared helper, signing once', async () => {
      const issueToken = jest.spyOn(tokens, 'issueToken');

      const result = await service.signup({
        username: 'newbie',
        email: 'newbie@example.com',
        password,
      });

      expect(issueToken).toHaveBeenCalledTimes(1);
      expect(jwtService.sign).toHaveBeenCalledTimes(1);
      expect(result.user).not.toHaveProperty('passwordHash');
    });
  });

  it('login uses the shared helper too', async () => {
    const issueToken = jest.spyOn(tokens, 'issueToken');

    await service.login({ email: 'player@example.com', password });

    expect(issueToken).toHaveBeenCalledTimes(1);
  });
});

describe('AuthTokenService', () => {
  const jwtService = { sign: jest.fn().mockReturnValue('t') };
  const tokens = new AuthTokenService(jwtService as unknown as JwtService);

  it('assertActive throws the shared inactive message', () => {
    expect(() => tokens.assertActive({ isActive: false })).toThrow(
      new UnauthorizedException(INACTIVE_USER_MESSAGE),
    );
    expect(() => tokens.assertActive({ isActive: true })).not.toThrow();
  });

  it('issueToken strips the password hash from the returned user', () => {
    const result = tokens.issueToken({
      id: 'u',
      email: 'e@example.com',
      username: 'n',
      role: Role.Admin,
      passwordHash: '$2b$04$secret',
    } as User);

    expect(result).toEqual({
      accessToken: 't',
      user: { id: 'u', email: 'e@example.com', username: 'n', role: Role.Admin },
    });
  });
});
