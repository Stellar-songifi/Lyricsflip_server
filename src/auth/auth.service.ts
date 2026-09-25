/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { Role } from './roles/role.enum';
import { User } from 'src/users/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
  ) {}

  async signup(
    signupDto: SignupDto,
  ): Promise<{ accessToken: string; user: Partial<User> }> {
    // Normalize again here (not just in the DTO) so any caller that bypasses
    // the DTO's @Transform still gets consistent, case-insensitive identity.
    const email = signupDto.email.trim().toLowerCase();
    const username = signupDto.username.trim();
    const { password } = signupDto;

    // Check if user already exists
    const existingUser = await this.userRepository
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .orWhere('LOWER(user.username) = LOWER(:username)', { username })
      .getOne();

    if (existingUser) {
      if (existingUser.email.toLowerCase() === email) {
        throw new ConflictException('Email already exists');
      }
      if (existingUser.username.toLowerCase() === username.toLowerCase()) {
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

    // Generate JWT
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role as Role,
    };
    const accessToken = this.jwtService.sign(payload);

    // Return user without password
    const { passwordHash: _, ...userWithoutPassword } = user;

    return {
      accessToken,
      user: userWithoutPassword,
    };
  }

  async login(
    loginDto: LoginDto,
  ): Promise<{ accessToken: string; user: Partial<User> }> {
    const email = loginDto.email.trim().toLowerCase();
    const { password } = loginDto;

    // Find user by email (case-insensitive)
    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email })
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

    // Update last login timestamp
    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    // Generate JWT
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role as Role,
    };
    const accessToken = this.jwtService.sign(payload);

    // Return user without password
    const { passwordHash: _, ...userWithoutPassword } = user;

    return {
      accessToken: this.jwtService.sign(payload),
      user: userWithoutPassword,
    };
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
