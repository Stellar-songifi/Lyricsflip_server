import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { XpLevelService } from './xp-level.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [XpLevelService],
  exports: [XpLevelService],
})
export class XpModule {}
