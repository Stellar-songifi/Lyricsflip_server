/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResult, AuthTokenService } from './services/auth-token.service';
import { User } from 'src/users/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private authTokenService: AuthTokenService,
  ) {}

  async signup(signupDto: SignupDto): Promise<AuthResult> {
    const { username, email, password } = signupDto;

    // Check if user already exists
    const existingUser = await this.userRepository.findOne({
      where: [{ email }, { username }],
    });

    if (existingUser) {
      if (existingUser.email === email) {
        throw new ConflictException('Email already exists');
      }
      if (existingUser.username === username) {
        throw new ConflictException('Username already exists');
      }
    }

    // Hash password using helper
    let passwordHash: string;
    try {
      passwordHash = await this.hashPassword(password);
    } catch (err) {
      throw new BadRequestException('Failed to hash password');
    }

    // Create user
    const user = this.userRepository.create({
      username,
      email,
      passwordHash,
    });

    try {
      await this.userRepository.save(user);
    } catch (error) {
      throw new BadRequestException('Failed to create user');
    }

    return this.authTokenService.issueToken(user);
  }

  async login(loginDto: LoginDto): Promise<AuthResult> {
    const { email, password } = loginDto;

    // passwordHash is select: false, so it must be requested explicitly
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password using helper
    let isPasswordValid: boolean;
    try {
      isPasswordValid = await this.validatePassword(
        password,
        user.passwordHash,
      );
    } catch (err) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Checked after the password so account status is not revealed to
    // someone who does not know it. Same message as the wallet flow.
    this.authTokenService.assertActive(user);

    // Update last login timestamp
    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    return this.authTokenService.issueToken(user);
  }
  // Hash a plaintext password using bcrypt

  private async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    try {
      return await bcrypt.hash(password, saltRounds);
    } catch (err) {
      throw new Error('Hashing failed');
    }
  }

  // Validate a plaintext password against a hash

  private async validatePassword(
    plain: string,
    hashed: string,
  ): Promise<boolean> {
    try {
      return await bcrypt.compare(plain, hashed);
    } catch (err) {
      return false;
    }
  }

  async validateUser(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }
}
