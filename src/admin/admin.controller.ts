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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/role.enum';
import { AdminService } from './admin.service';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Audited } from '../audit/decorators/audited.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { UserGroup } from '../users/user-serialization';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin)
@UseInterceptors(AuditInterceptor)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // --- User Management ---
  @Get('users')
  @SerializeOptions({ groups: [UserGroup.ADMIN] })
  findAllUsers(@Query() query: PaginationQueryDto) {
    return this.adminService.findAllUsers(query);
  }

  @Delete('users/:id')
  @Audited({ action: 'admin.user.delete', targetType: 'user' })
  deleteUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.deleteUser(id);
  }

  // --- Lyrics Management ---
  @Get('lyrics')
  findAllLyrics(
    @Query() query: PaginationQueryDto,
    @Query('status') status?: string,
  ) {
    return this.adminService.findAllLyrics(query, status);
  }

  @Post('lyrics/import')
  @Audited({ action: 'admin.lyric.import', targetType: 'lyric' })
  @UseInterceptors(FileInterceptor('file'))
  importLyrics(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { dryRun?: boolean | string },
  ) {
    const dryRun = body?.dryRun === true || body?.dryRun === 'true';
    return this.adminService.importLyrics(file, dryRun);
  }

  @Post('lyrics/:id/restore')
  @Audited({ action: 'admin.lyric.restore', targetType: 'lyric' })
  restoreLyric(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.restoreLyric(id);
  }

  @Delete('lyrics/:id')
  @Audited({ action: 'admin.lyric.delete', targetType: 'lyric' })
  deleteLyric(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.deleteLyric(id);
  }
}
