import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import type { LyricsService } from './lyrics.service';
import type { CreateLyricsDto } from './dto/create-lyrics.dto';
import type { UpdateLyricsDto } from './dto/update-lyrics.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import type { User } from '../users/entities/user.entity';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/roles/role.enum';
import { GetUser } from 'src/auth/decorators/user.decorator';

@ApiTags('lyrics')
@Controller('lyrics')
export class LyricsController {
  constructor(private readonly lyricsService: LyricsService) {}

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create new lyrics' })
  @ApiResponse({ status: 201, description: 'Lyrics created.' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @Post()
  create(@Body() createLyricsDto: CreateLyricsDto, @GetUser() user: User) {
    return this.lyricsService.create(createLyricsDto, user);
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
      'Filter by decade (4-digit year in decades: 1990, 2000, 2010, etc.)',
    type: 'number',
  })
  @ApiResponse({ status: 200, description: 'Array of filtered lyrics.' })
  @ApiResponse({ status: 404, description: 'No data matches your search.' })
  @Get()
  findAll(@Query('genre') genre?: string, @Query('decade') decade?: string) {
    const decadeNum = decade ? Number.parseInt(decade, 10) : undefined;
    return this.lyricsService.findAll(genre, decadeNum);
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
  getRandomLyrics(
    @Query('count') count?: string,
    @Query('genre') genre?: string,
    @Query('decade') decade?: string,
  ) {
    const countNum = count ? Number.parseInt(count, 10) : 1;
    const decadeNum = decade ? Number.parseInt(decade, 10) : undefined;
    return this.lyricsService.getRandomLyrics(countNum, genre, decadeNum);
  }

  @ApiOperation({ summary: 'Get lyrics by genre' })
  @ApiQuery({
    name: 'genre',
    required: true,
    description: 'Genre to filter by',
  })
  @Get('genre/:genre')
  getLyricsByGenre(@Param('genre') genre: string) {
    return this.lyricsService.getLyricsByCategory('genre', genre);
  }

  @ApiOperation({ summary: 'Get lyrics by decade' })
  @ApiQuery({
    name: 'decade',
    required: true,
    description: 'Decade to filter by',
  })
  @Get('decade/:decade')
  getLyricsByDecade(@Param('decade') decade: string) {
    const decadeNum = Number.parseInt(decade, 10);
    return this.lyricsService.getLyricsByCategory('decade', decadeNum);
  }

  @ApiOperation({ summary: 'Get lyrics by artist' })
  @ApiQuery({
    name: 'artist',
    required: true,
    description: 'Artist to filter by',
  })
  @Get('artist/:artist')
  getLyricsByArtist(@Param('artist') artist: string) {
    return this.lyricsService.getLyricsByCategory('artist', artist);
  }

  @ApiOperation({ summary: 'Get lyrics by ID' })
  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.lyricsService.findOne(id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update lyrics' })
  @ApiResponse({ status: 200, description: 'Lyrics updated.' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateLyricsDto: UpdateLyricsDto,
    @GetUser() user: User,
  ) {
    return this.lyricsService.update(id, updateLyricsDto, user);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete lyrics' })
  @ApiResponse({ status: 204, description: 'Lyrics deleted.' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.lyricsService.remove(id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clear lyrics cache (Admin only)' })
  @ApiResponse({ status: 200, description: 'Cache cleared successfully.' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @Post('cache/clear')
  clearCache() {
    return this.lyricsService.clearCache();
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get cache statistics (Admin only)' })
  @ApiResponse({ status: 200, description: 'Cache statistics retrieved.' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @Get('cache/stats')
  getCacheStats() {
    return this.lyricsService.getCacheStats();
  }
}
