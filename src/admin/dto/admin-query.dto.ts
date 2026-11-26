import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class AdminPaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class AdminAnalyticsOverviewQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export type AdminLyricsSort = 'accuracy' | 'attempts';

export class AdminAnalyticsLyricsQueryDto extends AdminAnalyticsOverviewQueryDto {
  @IsOptional()
  @IsIn(['accuracy', 'attempts'])
  sort?: AdminLyricsSort = 'accuracy';
}
