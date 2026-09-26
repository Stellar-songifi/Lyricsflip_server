import {
  Controller,
  Get,
  Delete,
  Param,
  UseGuards,
  ParseUUIDPipe,
  ParseIntPipe,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/role.enum';
import { AdminService } from './admin.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { UserGroup } from '../users/user-serialization';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // --- User Management ---
  @Get('users')
  @SerializeOptions({ groups: [UserGroup.ADMIN] })
  findAllUsers(@Query() { limit, offset }: PaginationQueryDto) {
    return this.adminService.findAllUsers(limit, offset);
  }

  @Delete('users/:id')
  deleteUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.deleteUser(id);
  }

  // --- Lyrics Management ---
  @Get('lyrics')
  findAllLyrics(@Query() { limit, offset }: PaginationQueryDto) {
    return this.adminService.findAllLyrics(limit, offset);
  }

  @Delete('lyrics/:id')
  deleteLyric(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.deleteLyric(id);
  }
}
