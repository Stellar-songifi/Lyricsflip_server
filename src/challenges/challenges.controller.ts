import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GetUser } from '../auth/decorators/user.decorator';
import { guessThrottle } from '../common/throttler/throttle.config';
import { User } from '../users/entities/user.entity';
import { ChallengesService } from './challenges.service';
import { DailyGuessDto } from './dto/daily-guess.dto';

@Controller('challenges/daily')
export class ChallengesController {
  constructor(private readonly challengesService: ChallengesService) {}

  /** GET /challenges/daily - today's shared set of lyrics. */
  @Get()
  getDaily(@GetUser() user: User) {
    return this.challengesService.getDaily(user.id);
  }

  /** POST /challenges/daily/guess - the one attempt at a lyric of the set. */
  @Throttle(guessThrottle)
  @Post('guess')
  @HttpCode(HttpStatus.OK)
  guess(@Body() dto: DailyGuessDto, @GetUser() user: User) {
    return this.challengesService.guess(user.id, dto);
  }

  /** GET /challenges/daily/leaderboard - today's ranking. */
  @Get('leaderboard')
  getLeaderboard() {
    return this.challengesService.getLeaderboard();
  }
}
