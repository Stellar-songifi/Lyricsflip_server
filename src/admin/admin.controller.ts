import {
  Controller,
  Get,
  Delete,
  Param,
  UseGuards,
  UseInterceptors,
  ParseUUIDPipe,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/role.enum';
import { AdminService } from './admin.service';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Audited } from '../audit/decorators/audited.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin)
@UseInterceptors(AuditInterceptor)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // --- User Management ---
  @Get('users')
  findAllUsers() {
    return this.adminService.findAllUsers();
  }

  @Delete('users/:id')
  @Audited({ action: 'admin.user.delete', targetType: 'user' })
  deleteUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.deleteUser(id);
  }

  // --- Lyrics Management ---
  @Get('lyrics')
  findAllLyrics() {
    return this.adminService.findAllLyrics();
  }

  @Delete('lyrics/:id')
  @Audited({ action: 'admin.lyric.delete', targetType: 'lyric' })
  deleteLyric(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.deleteLyric(id);
  }
}
