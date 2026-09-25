import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { User } from 'src/users/entities/user.entity';
import { INACTIVE_USER_MESSAGE } from '../services/auth-token.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private configService: ConfigService,
  ) {
    const jwtSecret = configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not set in environment variables');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    const { sub } = payload;
    const user = await this.userRepository.findOne({ where: { id: sub } });

    if (!user) {
      throw new UnauthorizedException('Token is invalid');
    }
    if (!user.isActive) {
      throw new UnauthorizedException(INACTIVE_USER_MESSAGE);
    }

    return user;
  }
}
