import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Largest page any list endpoint will return. */
export const MAX_PAGE_SIZE = 100;

/**
 * Shared `?limit=&offset=` query for list endpoints.
 *
 * Query strings arrive as strings, so @Type converts them before validation.
 * Anything that is not an integer in range (`abc`, `NaN`, `1.5`, `0`,
 * `100000`) is rejected with 400 instead of reaching `take` / `.limit()`.
 *
 * `limit` has no default here so each endpoint keeps its own default page
 * size; services fall back to it when `limit` is undefined.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** Envelope returned by every list endpoint. */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Wrap a page of results in the shared pagination envelope.
 *
 * `limit` and `offset` are the effective values used for the query (after
 * any endpoint-specific default has been applied), so clients can rely on
 * them to compute the next page.
 */
export function toPaginated<T>(
  items: T[],
  total: number,
  limit: number,
  offset: number,
): PaginatedResult<T> {
  return { items, total, limit, offset };
}