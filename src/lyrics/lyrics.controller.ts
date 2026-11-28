import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
// Value imports: `import type` erases these classes from the decorator
// metadata, so Nest could neither inject the service nor validate the DTOs.
import { LyricsService } from './lyrics.service';
import { CreateLyricDto } from './dto/create-lyric.dto';
import { UpdateLyricDto } from './dto/update-lyric.dto';
import { RandomLyricsQueryDto } from './dto/random-lyrics-query.dto';
import { SearchLyricsQueryDto } from './dto/search-lyrics-query.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { User } from '../users/entities/user.entity';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/role.enum';
import { GetUser } from '../auth/decorators/user.decorator';
import { Lyrics } from './entities/lyrics.entity';
import { AdminLyricDto, PlayerLyricDto } from './dto/lyric-response.dto';
import { normalizeDecade } from '../game/progression.util';

/**
 * Only admins see a lyric's answer. Every other caller gets the playable
 * fields, so these endpoints cannot be used to look up what `/game/lyric`
 * deliberately hides.
 */
function forCaller(lyric: Lyrics, user?: User): PlayerLyricDto | AdminLyricDto {
  return user?.role === Role.Admin
    ? AdminLyricDto.from(lyric)
    : PlayerLyricDto.from(lyric);
}

@ApiTags('lyrics')
@Controller('lyrics')
export class LyricsController {
  constructor(private readonly lyricsService: LyricsService) {}

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create new lyrics' })
  @ApiBody({ type: CreateLyricDto })
  @ApiCreatedResponse({ description: 'Lyrics created.', type: AdminLyricDto })
  @ApiBadRequestResponse({ description: 'The payload failed validation.' })
  @Roles(Role.Admin)
  @Post()
  async create(
    @Body() createLyricDto: CreateLyricDto,
    @GetUser() user: User,
  ): Promise<AdminLyricDto> {
    return AdminLyricDto.from(
      await this.lyricsService.create(createLyricDto, user),
    );
  }

  /**
   * GET /lyrics — paginated catalogue browse.
   *
   * Restricted to admins (R3-50): players get lyrics through /game/*, which
   * serves one round at a time and never reveals answers. Exposing the full
   * catalogue to players lets them build an answer lookup table.
   */
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List lyrics (Admin only)' })
  @ApiQuery({
    name: 'genre',
    required: false,
    description: 'Filter by genre (Afrobeats, Hip-Hop, Pop, Other)',
    enum: ['Afrobeats', 'Hip-Hop', 'Pop', 'Other'],
  })
  @ApiQuery({
    name: 'decade',
    required: false,
    description: 'Filter by decade (e.g. 1990 or 1990s)',
    type: 'string',
  })
  @ApiOkResponse({ description: 'Paginated list of lyrics.', type: [AdminLyricDto] })
  @ApiBadRequestResponse({ description: 'Invalid limit, offset, genre, or decade.' })
  @Roles(Role.Admin)
  @Get()
  async findAll(
    @GetUser() user: User,
    @Query() pagination: PaginationQueryDto,
    @Query('genre') genre?: string,
    @Query('decade') decade?: string,
  ) {
    const normalizedDecade = decade ? normalizeDecade(decade) : undefined;
    const lyrics = await this.lyricsService.findAll(
      genre,
      normalizedDecade,
      pagination.limit,
      pagination.offset,
    );
    return lyrics.map((lyric) => forCaller(lyric, user));
  }

  /**
   * GET /lyrics/random — a small random sample, for game warm-up or preview
   * purposes. `count` is validated to 1–20 by RandomLyricsQueryDto.
   *
   * Also restricted to admins (R3-50): a large or repeated count is a cheap
   * way to enumerate the catalogue and build an answer lookup.
   */
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get random lyrics (Admin only)' })
  @ApiOkResponse({ description: 'Random lyrics sample.' })
  @ApiBadRequestResponse({ description: 'Invalid count, genre, or decade.' })
  @Roles(Role.Admin)
  @Get('random')
  async getRandomLyrics(
    @GetUser() user: User,
    @Query() query: RandomLyricsQueryDto,
  ) {
    const normalizedDecade = query.decade
      ? normalizeDecade(query.decade)
      : undefined;
    const lyric = await this.lyricsService.getRandomLyrics(
      query.genre,
      normalizedDecade,
    );
    return forCaller(lyric, user);
  }

  /**
   * GET /lyrics/genre/:genre — paginated lyrics by genre.
   * Admin-only for the same reason as GET /lyrics.
   */
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get lyrics by genre (Admin only)' })
  @ApiBadRequestResponse({ description: 'Invalid genre.' })
  @Roles(Role.Admin)
  @Get('genre/:genre')
  async getLyricsByGenre(
    @Param('genre') genre: string,
    @GetUser() user: User,
  ) {
    const lyrics = await this.lyricsService.getLyricsByCategory(genre);
    return lyrics.map((lyric) => forCaller(lyric, user));
  }

  /**
   * GET /lyrics/decade/:decade — paginated lyrics by decade.
   * Admin-only for the same reason as GET /lyrics.
   */
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get lyrics by decade (Admin only)' })
  @ApiQuery({
    name: 'decade',
    required: true,
    description: 'Decade to filter by (e.g. 1990 or 1990s)',
  })
  @ApiBadRequestResponse({ description: 'Invalid decade.' })
  @Roles(Role.Admin)
  @Get('decade/:decade')
  async getLyricsByDecade(
    @Param('decade') decade: string,
    @GetUser() user: User,
  ) {
    const normalizedDecade = normalizeDecade(decade);
    const lyrics = await this.lyricsService.getLyricsByCategory(
      normalizedDecade,
    );
    return lyrics.map((lyric) => forCaller(lyric, user));
  }

  // Searching by artist is searching by answer, so it is admin tooling only.
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get lyrics by artist (Admin only)' })
  @ApiQuery({
    name: 'artist',
    required: true,
    description: 'Artist to filter by',
  })
  @Roles(Role.Admin)
  @Get('artist/:artist')
  getLyricsByArtist(@Param('artist') artist: string) {
    return this.lyricsService.findByArtist(artist);
  }

  // Full-text search spans answer fields (title/artist), so it is admin only.
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search lyrics (Admin only)' })
  @ApiQuery({
    name: 'q',
    required: true,
    description: 'Search term matched against lyric fields',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Results per page (default: 20)',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    description: 'Number of results to skip (default: 0)',
  })
  @ApiOkResponse({ description: 'Matching lyrics.', type: [AdminLyricDto] })
  @ApiBadRequestResponse({ description: 'The query failed validation.' })
  @Roles(Role.Admin)
  @Get('search')
  async search(@Query() query: SearchLyricsQueryDto): Promise<AdminLyricDto[]> {
    const lyrics = await this.lyricsService.searchLyrics(
      query.q,
      query.limit,
      query.offset,
    );
    return lyrics.map((lyric) => AdminLyricDto.from(lyric));
  }

  @ApiOperation({ summary: 'Get lyrics by ID' })
  @ApiResponse({ status: 400, description: 'The ID is not an integer.' })
  @ApiResponse({ status: 404, description: 'Lyrics not found.' })
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @GetUser() user: User) {
    return forCaller(await this.lyricsService.findOne(id), user);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update lyrics' })
  @ApiBody({ type: UpdateLyricDto })
  @ApiOkResponse({ description: 'Lyrics updated.', type: AdminLyricDto })
  @ApiBadRequestResponse({ description: 'The payload failed validation.' })
  @ApiResponse({ status: 404, description: 'Lyrics not found.' })
  @Roles(Role.Admin)
  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateLyricDto: UpdateLyricDto,
    @GetUser() user: User,
  ): Promise<AdminLyricDto> {
    return AdminLyricDto.from(
      await this.lyricsService.update(id, updateLyricDto, user),
    );
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete lyrics' })
  @ApiResponse({ status: 204, description: 'Lyrics deleted.' })
  @Roles(Role.Admin)
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.lyricsService.remove(id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clear lyrics cache (Admin only)' })
  @ApiResponse({ status: 200, description: 'Cache cleared successfully.' })
  @Roles(Role.Admin)
  @Post('cache/clear')
  clearCache() {
    return this.lyricsService.invalidateCache();
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get cache statistics (Admin only)' })
  @ApiResponse({ status: 200, description: 'Cache statistics retrieved.' })
  @Roles(Role.Admin)
  @Get('cache/stats')
  getCacheStats() {
    return this.lyricsService.getCacheStats();
  }
}
