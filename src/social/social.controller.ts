import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { GetUser } from '../auth/decorators/user.decorator';
import { User } from '../users/entities/user.entity';
import { SocialService } from './social.service';

@Controller()
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get('friends')
  listFriends(@GetUser() user: User) {
    return this.social.listFriends(user.id);
  }

  @Delete('friends/:id')
  @HttpCode(204)
  removeFriend(@GetUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.social.removeFriend(user.id, id);
  }

  @Post('friends/:id')
  @HttpCode(204)
  requestFriend(@GetUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.social.requestFriend(user.id, id);
  }

  @Post('friends/:id/accept')
  @HttpCode(204)
  acceptFriend(@GetUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.social.acceptFriend(user.id, id);
  }

  @Post('matchmaking/queue')
  enqueue(@GetUser() user: User) {
    return this.social.enqueue(user.id);
  }

  @Delete('matchmaking/queue')
  @HttpCode(204)
  dequeue(@GetUser() user: User) {
    return this.social.dequeue(user.id);
  }
}
