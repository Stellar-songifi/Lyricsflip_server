import { runtimeEnv } from '../config/runtime-env';
import {
  Controller,
  Get,
  Delete,
  Post,
  Param,
  UseInterceptors,
  ParseUUIDPipe,
  ParseIntPipe,
  Query,
  UploadedFile,
  Body,
  SerializeOptions,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/role.enum';
import { AdminService } from './admin.service';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Audited } from '../audit/decorators/audited.decorator';
import { UserGroup } from '../users/user-serialization';
import { ImportLyricsDto } from './dto/import-lyrics.dto';
import {
  GrantMockBalanceDto,
  GrantMockBalanceMode,
} from './dto/grant-mock-balance.dto';
import { AdminLyricQueryDto, AdminUserQueryDto } from './dto/admin-query.dto';
import {
  AdminPlayerReportQueryDto,
  ResolvePlayerReportDto,
} from '../moderation/player-report.dto';
import { GetUser } from '../auth/decorators/user.decorator';
import { User } from '../users/entities/user.entity';
import {
  AdminUserResponseDto,
  AdminLyricResponseDto,
  AdminDeleteResponseDto,
  AdminMockBalanceResponseDto,
  AdminImportLyricsResponseDto,
  AdminDeactivateBySourceResponseDto,
  AdminRestoreLyricResponseDto,
} from './dto/admin-response.dto';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

@ApiTags('admin')
@Controller('admin')
@Roles(Role.Admin)
@UseInterceptors(AuditInterceptor)
@ApiBearerAuth('JWT-auth')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('reports')
  findAllReports(@Query() query: AdminPlayerReportQueryDto) {
    return this.adminService.findAllReports(query);
  }

  @Post('reports/:id/resolve')
  @Audited({ action: 'admin.player-report.resolve', targetType: 'player-report' })
  resolveReport(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser() admin: User,
    @Body() dto: ResolvePlayerReportDto,
  ) {
    return this.adminService.resolveReport(id, admin.id, dto);
  }

  // --- User Management ---
  @Get('users')
  @ApiOperation({ summary: 'List users as an admin' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['createdAt', 'username', 'email', 'role'],
  })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['ASC', 'DESC'] })
  @ApiResponse({
    status: 200,
    description: 'List of users.',
    type: [AdminUserResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Forbidden.', type: ErrorResponseDto })
  @SerializeOptions({ groups: [UserGroup.ADMIN] })
  findAllUsers(@Query() query: AdminUserQueryDto) {
    return this.adminService.findAllUsers(query);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Delete a user record' })
  @ApiResponse({
    status: 200,
    description: 'User deleted.',
    type: AdminDeleteResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Forbidden.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'User not found.', type: ErrorResponseDto })
  @Audited({ action: 'admin.user.delete', targetType: 'user' })
  deleteUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.deleteUser(id);
  }

  @Post('users/:id/mock-balance')
  @ApiOperation({
    summary: 'Grant (add or set) a user mock balance (mock settlement mode only)',
  })
  @ApiBody({ type: GrantMockBalanceDto })
  @ApiResponse({
    status: 201,
    description: 'Mock balance updated.',
    type: AdminMockBalanceResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Forbidden.', type: ErrorResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Not available outside mock mode.',
    type: ErrorResponseDto,
  })
  @Audited({ action: 'admin.user.mock-balance', targetType: 'user' })
  grantMockBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantMockBalanceDto,
  ) {
    if (runtimeEnv().STELLAR_SETTLEMENT_MODE !== 'mock') {
      throw new NotFoundException();
    }
    return this.adminService.grantMockBalance(
      id,
      dto.amount,
      dto.mode ?? GrantMockBalanceMode.ADD,
    );
  }

  // --- Lyrics Management ---
  @Get('lyrics')
  @ApiOperation({ summary: 'List lyrics for admin review' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['createdAt', 'title', 'artist'],
  })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['ASC', 'DESC'] })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'inactive', 'all'],
  })
  @ApiQuery({
    name: 'source',
    required: false,
    type: String,
    description: 'Only lyrics from this source',
  })
  @ApiResponse({
    status: 200,
    description: 'List of lyrics.',
    type: [AdminLyricResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Forbidden.', type: ErrorResponseDto })
  findAllLyrics(@Query() query: AdminLyricQueryDto) {
    return this.adminService.findAllLyrics(query);
  }

  @Post('lyrics/import')
  @Audited({ action: 'admin.lyric.import', targetType: 'lyric' })
  @ApiOperation({ summary: 'Import lyrics from a CSV or JSON file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: ImportLyricsDto })
  @ApiResponse({
    status: 200,
    description: 'Import completed.',
    type: AdminImportLyricsResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid import file.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Forbidden.', type: ErrorResponseDto })
  @UseInterceptors(FileInterceptor('file'))
  importLyrics(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: ImportLyricsDto,
    @GetUser() user: User,
  ) {
    const dryRun = body?.dryRun === true || body?.dryRun === 'true';
    const mode = body?.mode === 'create-only' ? 'create-only' : 'upsert';
    return this.adminService.importLyrics(file, dryRun, user, mode);
  }

  /**
   * Takedown by source: deactivates every active lyric recorded as coming
   * from `source` in one statement. Audited with the source as the target;
   * the response lists the ids so individual lyrics can be restored.
   */
  @Post('lyrics/sources/:source/deactivate')
  @Audited({
    action: 'admin.lyric.deactivate-by-source',
    targetType: 'lyric_source',
    targetParam: 'source',
  })
  @ApiOperation({ summary: 'Deactivate all lyrics from one source' })
  @ApiResponse({
    status: 201,
    description: 'Lyrics deactivated; returns the count and their ids.',
    type: AdminDeactivateBySourceResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Forbidden.', type: ErrorResponseDto })
  deactivateLyricsBySource(@Param('source') source: string) {
    return this.adminService.deactivateLyricsBySource(source);
  }

  @Post('lyrics/:id/restore')
  @ApiOperation({ summary: 'Restore a deleted lyric' })
  @ApiResponse({
    status: 200,
    description: 'Lyric restored.',
    type: AdminRestoreLyricResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Forbidden.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Lyric not found.', type: ErrorResponseDto })
  @Audited({ action: 'admin.lyric.restore', targetType: 'lyric' })
  restoreLyric(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.restoreLyric(id);
  }

  @Delete('lyrics/:id')
  @Audited({ action: 'admin.lyric.delete', targetType: 'lyric' })
  @ApiOperation({ summary: 'Delete a lyric' })
  @ApiResponse({
    status: 200,
    description: 'Lyric deleted.',
    type: AdminDeleteResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Forbidden.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Lyric not found.', type: ErrorResponseDto })
  deleteLyric(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.deleteLyric(id);
  }

  // --- Analytics ---
  @Get('analytics/overview')
  @ApiOperation({
    summary:
      'Game health overview: DAU, WAU, signups, rounds, accuracy, wager outcomes',
  })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Overview metrics.', type: Object })
  getAnalyticsOverview(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adminService.getAnalyticsOverview(from, to);
  }

  @Get('analytics/lyrics')
  @ApiOperation({
    summary: 'Per-lyric attempts and accuracy to surface broken answers',
  })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['accuracy', 'attempts'],
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Per-lyric stats.', type: [Object] })
  getAnalyticsLyrics(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('sort') sort?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getAnalyticsLyrics(from, to, sort, limit);
  }
}
