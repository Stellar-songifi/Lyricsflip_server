import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { WagerMetricsService } from './wager-metrics.service';
import { Wager } from '../tokens/entities/wager.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Wager])],
  controllers: [MetricsController],
  providers: [MetricsService, WagerMetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
