import { JwtModule } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameController } from './game.controller';
import { GameGateway } from './game.gateway';
import { GameLogicService } from './game.service';
import { DifficultyCalibratorJob } from './difficulty-calibrator.job';
import { Lyrics } from '../lyrics/entities/lyrics.entity';
import { GameRound } from './entities/game-round.entity';
import { GameSession } from '../game-sessions/entities/game-session.entity';
import { GameHistory } from '../game-history/entities/game-history.entity';
import { XpModule } from '../xp/xp.module';
import { GameHistoryModule } from '../game-history/game-history.module';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lyrics, GameRound, GameSession, GameHistory]),
    JwtModule.register({}),
    XpModule,
    GameHistoryModule,
    JobsModule,
  ],
  providers: [GameLogicService, GameGateway, DifficultyCalibratorJob],
  controllers: [GameController],
  exports: [GameLogicService],
})
export class GameModule {}
