import { Type, applyDecorators } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  getSchemaPath,
} from '@nestjs/swagger';
import { SelectQueryBuilder } from 'typeorm';
import { PaginationQueryDto } from './pagination-query.dto';

/** Page size used when a request omits `limit`. */
export const DEFAULT_PAGE_SIZE = 20;

export class PaginationMetaDto {
  @ApiProperty() total: number;
  @ApiProperty() limit: number;
  @ApiProperty() offset: number;
  @ApiProperty() hasNext: boolean;
}

/** The one envelope every list endpoint returns. */
export interface PaginatedResponseDto<T> {
  data: T[];
  meta: PaginationMetaDto;
}

export function toPaginated<T>(
  data: T[],
  total: number,
  limit: number,
  offset: number,
): PaginatedResponseDto<T> {
  return {
    data,
    meta: { total, limit, offset, hasNext: offset + data.length < total },
  };
}

/** Applies `limit`/`offset` from the query to `qb` and wraps the result. */
export async function paginate<T extends object>(
  qb: SelectQueryBuilder<T>,
  query: PaginationQueryDto,
  defaultLimit = DEFAULT_PAGE_SIZE,
): Promise<PaginatedResponseDto<T>> {
  const limit = query.limit ?? defaultLimit;
  const offset = query.offset ?? 0;
  const [data, total] = await qb.take(limit).skip(offset).getManyAndCount();
  return toPaginated(data, total, limit, offset);
}

/** Swagger: documents a 200 response in the shared pagination envelope. */
export const ApiPaginatedResponse = <M extends Type<unknown>>(model: M) =>
  applyDecorators(
    ApiExtraModels(PaginationMetaDto, model),
    ApiOkResponse({
      schema: {
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(PaginationMetaDto) },
        },
      },
    }),
  );
