import { JwtModule } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameController } from './game.controller';
import { GameGateway } from './game.gateway';
import { GameLogicService } from './game.service';
import { DifficultyCalibratorJob } from './difficulty-calibrator.job';
import { Lyrics } from 'src/lyrics/entities/lyrics.entity';
import { GameRound } from './entities/game-round.entity';
import { GameSession } from 'src/game-sessions/entities/game-session.entity';
import { GameHistory } from 'src/game-history/entities/game-history.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lyrics, GameRound, GameSession, GameHistory]),
    JwtModule.register({}),
  ],
  providers: [GameLogicService, GameGateway, DifficultyCalibratorJob],
  controllers: [GameController],
  exports: [GameLogicService],
})
export class GameModule {}
