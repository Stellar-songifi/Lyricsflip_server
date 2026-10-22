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

/** An unlocked achievement as shown on a public profile. */
export class PublicAchievementDto {
  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;
}

/**
 * A player as anyone may see them (GET /users/:username/public). These are
 * the only public fields; email, wallet, preferences and flags never appear.
 */
export class PublicUserDto {
  @ApiProperty()
  username: string;

  @ApiProperty()
  level: number;

  @ApiProperty({ enum: UserLevel })
  levelTitle: UserLevel;

  @ApiProperty()
  xp: number;

  @ApiProperty({ description: 'When the account was created' })
  createdAt: Date;

  @ApiProperty({ description: 'Completed head-to-head sessions won' })
  wins: number;

  @ApiProperty({ description: 'Completed head-to-head sessions lost' })
  losses: number;

  @ApiProperty({ description: 'wins / (wins + losses), 0 with no games' })
  winRate: number;

  @ApiProperty({ type: [PublicAchievementDto] })
  achievements: PublicAchievementDto[];

  static from(
    user: User,
    record: { wins: number; losses: number },
    achievements: PublicAchievementDto[],
  ): PublicUserDto {
    const games = record.wins + record.losses;
    return {
      username: user.username,
      level: user.level,
      levelTitle: user.levelTitle,
      xp: user.xp,
      createdAt: user.createdAt,
      wins: record.wins,
      losses: record.losses,
      winRate: games > 0 ? record.wins / games : 0,
      achievements,
    };
  }
}
