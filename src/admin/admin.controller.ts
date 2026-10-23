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
import { AdminUserQueryDto } from './dto/admin-user-query.dto';
import { AdminLyricQueryDto } from './dto/admin-lyric-query.dto';
import { AdminReportQueryDto } from './dto/admin-report-query.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('admin')
@Controller('admin')
@Roles(Role.Admin)
@UseInterceptors(AuditInterceptor)
@ApiBearerAuth('JWT-auth')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

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
  @ApiResponse({ status: 200, description: 'List of users.', type: [Object] })
  @SerializeOptions({ groups: [UserGroup.ADMIN] })
  findAllUsers(@Query() query: AdminUserQueryDto) {
    return this.adminService.findAllUsers(query);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Delete a user record' })
  @ApiResponse({ status: 200, description: 'User deleted.' })
  @Audited({ action: 'admin.user.delete', targetType: 'user' })
  deleteUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.deleteUser(id);
  }

  @Post('users/:id/mock-balance')
  @ApiOperation({
    summary: 'Grant (add or set) a user mock balance (mock settlement mode only)',
  })
  @ApiBody({ type: GrantMockBalanceDto })
  @ApiResponse({ status: 201, description: 'Mock balance updated.' })
  @ApiResponse({ status: 404, description: 'Not available outside mock mode.' })
  @Audited({ action: 'admin.user.mock-balance', targetType: 'user' })
  grantMockBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantMockBalanceDto,
  ) {
    if (process.env.STELLAR_SETTLEMENT_MODE !== 'mock') {
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
  @ApiResponse({ status: 200, description: 'List of lyrics.', type: [Object] })
  findAllLyrics(@Query() query: AdminLyricQueryDto) {
    return this.adminService.findAllLyrics(query);
  }

  @Post('lyrics/import')
  @Audited({ action: 'admin.lyric.import', targetType: 'lyric' })
  @ApiOperation({ summary: 'Import lyrics from a CSV or JSON file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: ImportLyricsDto })
  @ApiResponse({ status: 200, description: 'Import completed.', type: Object })
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

  @Post('lyrics/:id/restore')
  @ApiOperation({ summary: 'Restore a deleted lyric' })
  @ApiResponse({ status: 200, description: 'Lyric restored.' })
  @Audited({ action: 'admin.lyric.restore', targetType: 'lyric' })
  restoreLyric(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.restoreLyric(id);
  }

  @Delete('lyrics/:id')
  @Audited({ action: 'admin.lyric.delete', targetType: 'lyric' })
  @ApiOperation({ summary: 'Delete a lyric' })
  @ApiResponse({ status: 200, description: 'Lyric deleted.' })
  deleteLyric(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.deleteLyric(id);
  }

  // --- Lyric Reports ---
  @Get('reports')
  @ApiOperation({ summary: 'List lyric reports for admin review' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['open', 'resolved', 'dismissed', 'all'],
  })
  @ApiQuery({
    name: 'reason',
    required: false,
    enum: ['wrong_lyrics', 'wrong_answer', 'typo', 'offensive', 'other'],
  })
  @ApiQuery({ name: 'lyricId', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of reports.', type: [Object] })
  findAllReports(@Query() query: AdminReportQueryDto) {
    return this.adminService.findAllReports(query);
  }

  @Post('reports/:id/resolve')
  @ApiOperation({ summary: 'Resolve a lyric report' })
  @ApiBody({ type: ResolveReportDto })
  @ApiResponse({ status: 200, description: 'Report resolved.' })
  @Audited({ action: 'admin.report.resolve', targetType: 'lyric_report' })
  resolveReport(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReportDto,
    @GetUser() user: User,
  ) {
    return this.adminService.resolveReport(id, dto, user);
  }
}
