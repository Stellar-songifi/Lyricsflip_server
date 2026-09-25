import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const LEADERBOARD_SORTS = ['xp', 'level', 'username'] as const;
export const SORT_ORDERS = ['ASC', 'DESC'] as const;

export class LeaderboardQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: LEADERBOARD_SORTS, default: 'xp' })
  @IsOptional()
  @IsIn(LEADERBOARD_SORTS)
  sort?: (typeof LEADERBOARD_SORTS)[number];

  @ApiPropertyOptional({ enum: SORT_ORDERS, default: 'DESC' })
  @IsOptional()
  @IsIn(SORT_ORDERS)
  order?: (typeof SORT_ORDERS)[number];
}
