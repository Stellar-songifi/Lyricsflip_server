import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';

import { User } from '../../users/entities/user.entity';
import { PasswordResetToken } from '../entities/password-reset-token.entity';
import { MailerService } from './mailer.service';

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetTokenRepository: Repository<PasswordResetToken>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly mailerService: MailerService,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Issue a single-use password reset token for the given user.
   * Only the SHA-256 hash of the token is persisted; the raw token is
   * delivered to the user via email.
   */
  async issue(user: User): Promise<void> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    const token = this.passwordResetTokenRepository.create({
      tokenHash,
      userId: user.id,
      expiresAt,
      usedAt: null,
    });

    await this.passwordResetTokenRepository.save(token);

    try {
      await this.mailerService.sendPasswordResetEmail(user.email, rawToken);
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email to ${user.email}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Consume a password reset token. Returns the associated user if the token
   * is valid, unused and unexpired. The token is marked as used atomically so
   * it can only be redeemed once. Pass an `EntityManager` to run inside the
   * caller's transaction (so a failure later rolls the consumption back).
   */
  async consume(rawToken: string, manager?: EntityManager): Promise<User> {
    const invalid = () =>
      new BadRequestException('Invalid or expired password reset token');
    if (!rawToken || typeof rawToken !== 'string') {
      throw invalid();
    }

    const tokenRepo = manager
      ? manager.getRepository(PasswordResetToken)
      : this.passwordResetTokenRepository;
    const userRepo = manager
      ? manager.getRepository(User)
      : this.userRepository;

    const tokenHash = this.hashToken(rawToken);
    const token = await tokenRepo.findOne({ where: { tokenHash } });

    if (!token || token.usedAt || token.expiresAt.getTime() <= Date.now()) {
      throw invalid();
    }

    // Conditional update guards against two concurrent redemptions.
    const result = await tokenRepo.update(
      { id: token.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    if (!result.affected) {
      throw invalid();
    }

    const user = await userRepo.findOne({ where: { id: token.userId } });
    if (!user) {
      throw invalid();
    }
    return user;
  }
}
