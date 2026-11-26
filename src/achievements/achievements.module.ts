import { Global, Module } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Achievement } from './achievement.entity';
import { UserAchievement } from './user-achievement.entity';
import {
  AchievementsService,
  TypeOrmAchievementsRepository,
} from './achievements.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Achievement, UserAchievement])],
  providers: [
    TypeOrmAchievementsRepository,
    {
      provide: AchievementsService,
      inject: [TypeOrmAchievementsRepository, EventEmitter2],
      useFactory: (
        repository: TypeOrmAchievementsRepository,
        events: EventEmitter2,
      ) => new AchievementsService(repository, events),
    },
  ],
  exports: [AchievementsService],
})
export class AchievementsModule {}
