import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

export class CreatePlayerReportDto {
  @IsIn(['harassment', 'inappropriate_username', 'cheating', 'other'])
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AdminPlayerReportQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['open', 'resolved', 'dismissed'])
  status?: string;
}

export class ResolvePlayerReportDto {
  @IsIn(['resolved', 'dismissed'])
  status: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  resolution?: string;
}
