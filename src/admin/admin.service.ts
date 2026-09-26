import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { LyricsService } from 'src/lyrics/lyrics.service';

@Injectable()
export class AdminService {
  constructor(
    private usersService: UsersService,
    private lyricsService: LyricsService,
  ) {}

  findAllUsers(limit?: number, offset?: number) {
    return this.usersService.findAll(limit, offset);
  }

  async deleteUser(id: string) {
    const result = await this.usersService.remove(id);
    return result.message || 'User deleted successfully';
  }

  findAllLyrics(limit?: number, offset?: number) {
    return this.lyricsService.findAll(undefined, undefined, limit, offset);
  }

  deleteLyric(id: number) {
    return this.lyricsService.remove(id);
  }
}
