import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameModule } from '../game/game.module';
import { Lyrics } from '../lyrics/entities/lyrics.entity';
import { XpModule } from '../xp-level/xp.module';
import { ChallengesController } from './challenges.controller';
import { ChallengesService } from './challenges.service';
import { DailyChallenge } from './entities/daily-challenge.entity';
import { DailyChallengeAttempt } from './entities/daily-challenge-attempt.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DailyChallenge, DailyChallengeAttempt, Lyrics]),
    GameModule,
    XpModule,
  ],
  controllers: [ChallengesController],
  providers: [ChallengesService],
})
export class ChallengesModule {}
