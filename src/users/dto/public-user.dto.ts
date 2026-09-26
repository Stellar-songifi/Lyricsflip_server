import { ApiProperty } from '@nestjs/swagger';
import { User, UserLevel } from '../entities/user.entity';

/** The minimum needed to show another player: who they are, nothing else. */
export class PlayerSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  username: string;

  static from(user: Pick<User, 'id' | 'username'>): PlayerSummaryDto {
    return { id: user.id, username: user.username };
  }
}

/** A user as anyone may see them: identity plus leaderboard-public stats. */
export class PublicUserDto extends PlayerSummaryDto {
  @ApiProperty()
  xp: number;

  @ApiProperty()
  level: number;

  @ApiProperty({ enum: UserLevel })
  levelTitle: UserLevel;

  static from(user: User): PublicUserDto {
    return {
      id: user.id,
      username: user.username,
      xp: user.xp,
      level: user.level,
      levelTitle: user.levelTitle,
    };
  }
}
