import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export enum AdminUserSortBy {
  CREATED_AT = 'createdAt',
  EMAIL = 'email',
  USERNAME = 'username',
}

export enum AdminLyricSortBy {
  CREATED_AT = 'createdAt',
  TITLE = 'title',
  ARTIST = 'artist',
}

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export enum AdminLyricStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ALL = 'all',
}

export class AdminUserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Column to sort users by',
    enum: AdminUserSortBy,
    default: AdminUserSortBy.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(AdminUserSortBy)
  sortBy?: AdminUserSortBy = AdminUserSortBy.CREATED_AT;

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: SortOrder,
    default: SortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.DESC;
}

export class AdminLyricQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Column to sort lyrics by',
    enum: AdminLyricSortBy,
    default: AdminLyricSortBy.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(AdminLyricSortBy)
  sortBy?: AdminLyricSortBy = AdminLyricSortBy.CREATED_AT;

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: SortOrder,
    default: SortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.DESC;

  @ApiPropertyOptional({
    description: 'Filter lyrics by status',
    enum: AdminLyricStatus,
    default: AdminLyricStatus.ALL,
  })
  @IsOptional()
  @IsIn([AdminLyricStatus.ACTIVE, AdminLyricStatus.INACTIVE, AdminLyricStatus.ALL])
  status?: AdminLyricStatus = AdminLyricStatus.ALL;

  @ApiPropertyOptional({
    description: 'Only lyrics from this source (case-insensitive)',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  source?: string;
}