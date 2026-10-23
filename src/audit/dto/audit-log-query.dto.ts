import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class AuditLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Actor user UUID, or "system"' })
  @IsOptional()
  @ValidateIf((_, v) => v !== 'system')
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ example: 'admin.user.delete' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ example: 'user' })
  @IsOptional()
  @IsString()
  targetType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  targetId?: string;

  @ApiPropertyOptional({ description: 'Inclusive lower bound (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Inclusive upper bound (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class AuditLogExportQueryDto extends AuditLogQueryDto {
  @ApiPropertyOptional({ enum: ['csv'], default: 'csv' })
  @IsOptional()
  @IsIn(['csv'])
  format?: 'csv';
}
