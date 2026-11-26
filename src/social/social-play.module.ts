import { Module } from '@nestjs/common';
import { TournamentsController } from '../tournaments/tournaments.controller';
import { TournamentsService } from '../tournaments/tournaments.service';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';

@Module({
  controllers: [SocialController, TournamentsController],
  providers: [SocialService, TournamentsService],
})
export class SocialPlayModule {}
