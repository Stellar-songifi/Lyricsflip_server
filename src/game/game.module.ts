import { JwtModule } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameController } from './game.controller';
import { GameGateway } from './game.gateway';
import { GameLogicService } from './game.service';
import { Lyrics } from 'src/lyrics/entities/lyrics.entity';
import { GameRound } from './entities/game-round.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Lyrics]), JwtModule.register({})],
  providers: [GameLogicService, GameGateway],
  imports: [TypeOrmModule.forFeature([Lyrics, GameRound])],
  providers: [GameLogicService],
  controllers: [GameController],
  exports: [GameLogicService],
})
export class GameModule {}
