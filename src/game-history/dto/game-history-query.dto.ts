import {
  IsOptional,
  IsNumberString,
  IsEnum,
  IsDateString,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { MAX_PAGE_SIZE } from '../../common/dto/pagination-query.dto';
import { GuessType } from '../../game/dto/guess.dto';

export class GameHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  // Same bounds as PaginationQueryDto; this endpoint pages by `page`.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number = 10;

  @IsOptional()
  @IsEnum(GuessType)
  guessType?: GuessType;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  isCorrect?: boolean;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsNumberString()
  lyricId?: string;
}
