import { Module } from '@nestjs/common';
import { RetentionJob } from './retention.job';

/** Scheduled enforcement of the personal-data retention policy. */
@Module({
  providers: [RetentionJob],
})
export class RetentionModule {}
