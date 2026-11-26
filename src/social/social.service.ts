import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import {
  GameCategory,
  GameMode,
  GameSession,
  GameSessionStatus,
} from '../game-sessions/entities/game-session.entity';
import {
  arePlayersBlocked,
  assertPlayersCanInteract,
} from '../moderation/player-blocks';
import { RealtimeEvent } from '../realtime/realtime.events';
import { lockPlayerPair, orderedPlayers } from './player-pair';

@Injectable()
export class SocialService {
  constructor(
    private readonly db: DataSource,
    private readonly events: EventEmitter2,
  ) {}

  listFriends(userId: string) {
    return this.db.query<
      Array<{ id: string; username: string; status: string; incoming: boolean }>
    >(
      `SELECT u.id, u.username, f.status, f."requesterId" <> $1 AS incoming
       FROM friendships f JOIN users u ON u.id =
         CASE WHEN f."firstId" = $1 THEN f."secondId" ELSE f."firstId" END
       WHERE $1 IN (f."firstId", f."secondId") AND u."isActive"
       ORDER BY f."createdAt", u.id`,
      [userId],
    );
  }

  async removeFriend(userId: string, otherId: string): Promise<void> {
    const [first, second] = orderedPlayers(userId, otherId);
    await this.db.transaction(async (manager) => {
      await lockPlayerPair(manager, first, second);
      await manager.query(
        'DELETE FROM friendships WHERE "firstId" = $1 AND "secondId" = $2',
        [first, second],
      );
    });
  }

  async requestFriend(userId: string, otherId: string): Promise<void> {
    if (userId === otherId)
      throw new ConflictException('This interaction is unavailable');
    const [first, second] = orderedPlayers(userId, otherId);
    await this.db.transaction(async (manager) => {
      await lockPlayerPair(manager, first, second);
      await assertPlayersCanInteract(manager, first, second);
      const [other] = await manager.query<unknown[]>(
        'SELECT id FROM users WHERE id = $1 AND "isActive"',
        [otherId],
      );
      if (!other) throw new NotFoundException('Player not found');
      await manager.query(
        `INSERT INTO friendships ("firstId", "secondId", "requesterId")
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [first, second, userId],
      );
    });
  }

  async acceptFriend(userId: string, otherId: string): Promise<void> {
    const [first, second] = orderedPlayers(userId, otherId);
    await this.db.transaction(async (manager) => {
      await lockPlayerPair(manager, first, second);
      await assertPlayersCanInteract(manager, first, second);
      const rows = await manager.query<unknown[]>(
        `WITH accepted AS (
           UPDATE friendships SET status = 'accepted'
           WHERE "firstId" = $1 AND "secondId" = $2 AND "requesterId" = $3
             AND status = 'pending' RETURNING "firstId"
         ) SELECT * FROM accepted`,
        [first, second, otherId],
      );
      if (!rows.length) throw new NotFoundException('Friend request not found');
    });
  }

  async enqueue(userId: string) {
    const paired = await this.db.transaction(async (manager) => {
      // Serialize queue changes so two requests cannot consume the same entry.
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('quick-match', 0))",
      );
      await manager.query(
        `DELETE FROM quick_match_queue WHERE "joinedAt" < now() - interval '5 minutes'`,
      );
      await manager.query(
        'INSERT INTO quick_match_queue ("userId") VALUES ($1) ON CONFLICT DO NOTHING',
        [userId],
      );
      const candidates = await manager.query<Array<{ userId: string }>>(
        `SELECT q."userId" FROM quick_match_queue q
         JOIN users u ON u.id = q."userId" AND u."isActive"
         WHERE q."userId" <> $1 AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
           WHERE (b."blockerId" = $1 AND b."blockedId" = q."userId")
              OR (b."blockerId" = q."userId" AND b."blockedId" = $1)
         ) ORDER BY q."joinedAt", q."userId" LIMIT 1`,
        [userId],
      );
      const candidate = candidates[0]?.userId;
      if (!candidate) return null;
      await lockPlayerPair(manager, candidate, userId);
      if (await arePlayersBlocked(manager, candidate, userId)) return null;

      const sessions = manager.getRepository(GameSession);
      const session = await sessions.save(
        sessions.create({
          player: { id: candidate },
          playerTwoId: userId,
          mode: GameMode.MULTIPLAYER,
          category: GameCategory.POP,
          status: GameSessionStatus.WAITING_FOR_PLAYER,
        }),
      );
      await manager.query(
        'DELETE FROM quick_match_queue WHERE "userId" IN ($1, $2)',
        [userId, candidate],
      );
      return { sessionId: session.id, players: [candidate, userId] };
    });
    if (paired) this.events.emit(RealtimeEvent.MATCH_FOUND, paired);
    return { sessionId: paired?.sessionId ?? null };
  }

  async dequeue(userId: string): Promise<void> {
    await this.db.transaction(async (manager) => {
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('quick-match', 0))",
      );
      await manager.query('DELETE FROM quick_match_queue WHERE "userId" = $1', [
        userId,
      ]);
    });
  }
}
