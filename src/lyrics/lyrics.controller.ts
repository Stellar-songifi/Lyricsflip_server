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
import { CreateLyricsDto } from './dto/create-lyrics.dto';
import { UpdateLyricsDto } from './dto/update-lyrics.dto';
import { SearchLyricsQueryDto } from './dto/search-lyrics-query.dto';
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
import { Roles } from 'src/auth/roles/roles.decorator';
import { Role } from 'src/auth/roles/role.enum';
import { GetUser } from 'src/auth/decorators/user.decorator';
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
  @ApiBody({ type: CreateLyricsDto })
  @ApiCreatedResponse({ description: 'Lyrics created.', type: AdminLyricDto })
  @ApiBadRequestResponse({ description: 'The payload failed validation.' })
  @Roles(Role.Admin)
  @Post()
  async create(
    @Body() createLyricsDto: CreateLyricsDto,
    @GetUser() user: User,
  ): Promise<AdminLyricDto> {
    return AdminLyricDto.from(
      await this.lyricsService.create(createLyricsDto, user),
    );
  }

  @ApiOperation({ summary: 'Get filtered lyrics' })
  @ApiQuery({
    name: 'genre',
    required: false,
    description: 'Filter by genre (Afrobeats, Hip-Hop, Pop, Other)',
    enum: ['Afrobeats', 'Hip-Hop', 'Pop', 'Other'],
  })
  @ApiQuery({
    name: 'decade',
    required: false,
    description:
      'Filter by decade (e.g. 1990 or 1990s; both resolve to the 1990s)',
    type: 'string',
  })
  @ApiResponse({ status: 200, description: 'Array of filtered lyrics.' })
  @ApiResponse({ status: 404, description: 'No data matches your search.' })
  @Get()
  async findAll(
    @GetUser() user: User,
    @Query('genre') genre?: string,
    @Query('decade') decade?: string,
  ) {
    const normalizedDecade = decade ? normalizeDecade(decade) : undefined;
    const lyrics = await this.lyricsService.findAll(genre, normalizedDecade);
    return lyrics.map((lyric) => forCaller(lyric, user));
  }

  @ApiOperation({ summary: 'Get random lyrics' })
  @ApiQuery({
    name: 'count',
    required: false,
    description: 'Number of random lyrics to fetch (default: 1)',
  })
  @ApiQuery({ name: 'genre', required: false, description: 'Filter by genre' })
  @ApiQuery({
    name: 'decade',
    required: false,
    description: 'Filter by decade',
  })
  @Get('random')
  async getRandomLyrics(
    @GetUser() user: User,
    @Query('count') count?: string,
    @Query('genre') genre?: string,
    @Query('decade') decade?: string,
  ) {
    const countNum = count ? Number.parseInt(count, 10) : 1;
    const normalizedDecade = decade ? normalizeDecade(decade) : undefined;
    const lyrics = await this.lyricsService.getRandomLyrics(
      countNum,
      genre,
      normalizedDecade,
    );
    return lyrics.map((lyric) => forCaller(lyric, user));
  }

  @ApiOperation({ summary: 'Get lyrics by genre' })
  @ApiQuery({
    name: 'genre',
    required: true,
    description: 'Genre to filter by',
  })
  @Get('genre/:genre')
  async getLyricsByGenre(@Param('genre') genre: string, @GetUser() user: User) {
    const lyrics = await this.lyricsService.getLyricsByCategory(genre);
    return lyrics.map((lyric) => forCaller(lyric, user));
  }

  @ApiOperation({ summary: 'Get lyrics by decade' })
  @ApiQuery({
    name: 'decade',
    required: true,
    description: 'Decade to filter by (e.g. 1990 or 1990s)',
  })
  @Get('decade/:decade')
  async getLyricsByDecade(
    @Param('decade') decade: string,
    @GetUser() user: User,
  ) {
    const normalizedDecade = normalizeDecade(decade);
    const lyrics = await this.lyricsService.getLyricsByCategory(
      'decade',
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
    name: 'page',
    required: false,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Results per page (default: 20)',
  })
  @ApiOkResponse({ description: 'Matching lyrics.', type: [AdminLyricDto] })
  @ApiBadRequestResponse({ description: 'The query failed validation.' })
  @Roles(Role.Admin)
  @Get('search')
  async search(@Query() query: SearchLyricsQueryDto): Promise<AdminLyricDto[]> {
    const lyrics = await this.lyricsService.searchLyrics(
      query.q,
      query.page,
      query.limit,
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
  @ApiBody({ type: UpdateLyricsDto })
  @ApiOkResponse({ description: 'Lyrics updated.', type: AdminLyricDto })
  @ApiBadRequestResponse({ description: 'The payload failed validation.' })
  @ApiResponse({ status: 404, description: 'Lyrics not found.' })
  @Roles(Role.Admin)
  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateLyricsDto: UpdateLyricsDto,
    @GetUser() user: User,
  ): Promise<AdminLyricDto> {
    return AdminLyricDto.from(
      await this.lyricsService.update(id, updateLyricsDto, user),
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
