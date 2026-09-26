import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lyrics } from './entities/lyrics.entity';
import { LyricsService } from './lyrics.service';
import { LyricsController } from './lyrics.controller';

// Caching uses the global CacheModule registered in AppModule. A module-local
// CacheModule.register would create a second, separate store.
@Module({
  imports: [TypeOrmModule.forFeature([Lyrics])],
  providers: [LyricsService],
  controllers: [LyricsController],
  exports: [LyricsService],
})
export class LyricsModule {}
