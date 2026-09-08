import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { LyricsService } from 'src/lyrics/lyrics.service';

@Injectable()
export class AdminService {
  constructor(
    private usersService: UsersService,
    private lyricsService: LyricsService,
  ) {}

  findAllUsers() {
    return this.usersService.findAll();
  }

  async deleteUser(id: string) {
    const result = await this.usersService.remove(id);
    return result.message || 'User deleted successfully';
  }

  findAllLyrics() {
    return this.lyricsService.findAll();
  }

  deleteLyric(id: number) {
    return this.lyricsService.remove(id);
  }
}
