import {
  Controller,
  Get,
  Delete,
  Post,
  Param,
  UseGuards,
  UseInterceptors,
  ParseUUIDPipe,
  ParseIntPipe,
  Query,
  UploadedFile,
  Body,
  SerializeOptions,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/role.enum';
import { AdminService } from './admin.service';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Audited } from '../audit/decorators/audited.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { UserGroup } from '../users/user-serialization';
import { ImportLyricsDto } from './dto/import-lyrics.dto';

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin)
@UseInterceptors(AuditInterceptor)
@ApiBearerAuth('JWT-auth')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // --- User Management ---
  @Get('users')
  @ApiOperation({ summary: 'List users as an admin' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of users.', type: [Object] })
  @SerializeOptions({ groups: [UserGroup.ADMIN] })
  findAllUsers(@Query() query: PaginationQueryDto) {
    return this.adminService.findAllUsers(query);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Delete a user record' })
  @ApiResponse({ status: 200, description: 'User deleted.' })
  @Audited({ action: 'admin.user.delete', targetType: 'user' })
  deleteUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.deleteUser(id);
  }

  // --- Lyrics Management ---
  @Get('lyrics')
  @ApiOperation({ summary: 'List lyrics for admin review' })
  @ApiResponse({ status: 200, description: 'List of lyrics.', type: [Object] })
  findAllLyrics(
    @Query() query: PaginationQueryDto,
    @Query('status') status?: string,
  ) {
    return this.adminService.findAllLyrics(query, status);
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
  ) {
    const dryRun = body?.dryRun === true || body?.dryRun === 'true';
    return this.adminService.importLyrics(file, dryRun);
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
}
