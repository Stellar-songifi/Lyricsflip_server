import {
  arePlayersBlocked,
  assertPlayersCanInteract,
} from '../moderation/player-blocks';
import { RealtimeEvent } from '../realtime/realtime.events';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import {
  GameCategory,
  GameMode,
  GameSession,
  GameSessionStatus,
} from '../game-sessions/entities/game-session.entity';
import { matchGuess } from '../game/guess-matcher';
import { Lyrics } from '../lyrics/entities/lyrics.entity';
import { lockPlayerPair } from '../social/player-pair';

const MATCH_WINDOW_MS = 60_000;

export interface Tournament {
  id: string;
  name: string;
  format: string;
  maxPlayers: number;
  startsAt: Date;
  status: 'registration' | 'running' | 'completed' | 'cancelled';
  winnerId: string | null;
}

interface Match {
  id: string;
  round: number;
  slot: number;
  firstId: string | null;
  secondId: string | null;
  winnerId: string | null;
  sessionId: string | null;
  lyricId: number | null;
  deadline: Date | null;
  firstPoints: number | null;
  secondPoints: number | null;
  firstAt: Date | null;
  secondAt: Date | null;
  finishedAt: Date | null;
}

@Injectable()
export class TournamentsService {
  constructor(
    private readonly db: DataSource,
    private readonly events: EventEmitter2,
  ) {}

  async create(
    name: string,
    maxPlayers: number,
    startsAt: Date,
  ): Promise<Tournament> {
    if (startsAt <= new Date())
      throw new BadRequestException('Start time must be in the future');
    const [row] = await this.db.query<Tournament[]>(
      'INSERT INTO tournaments (name, "maxPlayers", "startsAt") VALUES ($1, $2, $3) RETURNING *',
      [name, maxPlayers, startsAt],
    );
    return row;
  }

  async register(id: string, userId: string): Promise<void> {
    await this.db.transaction(async (manager) => {
      const tournament = await this.load(manager, id, true);
      if (
        tournament.status !== 'registration' ||
        tournament.startsAt <= new Date()
      ) {
        throw new ConflictException('Registration is closed');
      }
      const entries = await this.entries(manager, id);
      if (entries.some((entry) => entry.userId === userId)) return;
      if (entries.length >= tournament.maxPlayers)
        throw new ConflictException('Tournament is full');
      await manager.query(
        'INSERT INTO tournament_entries ("tournamentId", "userId", seed) VALUES ($1, $2, $3)',
        [id, userId, entries.length + 1],
      );
    });
  }

  async bracket(id: string) {
    const tournament = await this.load(this.db.manager, id);
    const matches = await this.matches(this.db.manager, id);
    return {
      ...tournament,
      matches: matches.map((match) => ({
        id: match.id,
        round: match.round,
        slot: match.slot,
        firstId: match.firstId,
        secondId: match.secondId,
        sessionId: match.sessionId,
        deadline: match.deadline,
        finishedAt: match.finishedAt,
        winnerId: match.winnerId,
        ...(match.finishedAt && {
          firstPoints: match.firstPoints ?? 0,
          secondPoints: match.secondPoints ?? 0,
        }),
      })),
    };
  }

  async question(id: string, matchId: string, userId: string) {
    const match = await this.activeMatch(this.db.manager, id, matchId, userId);
    const lyric = await this.db
      .getRepository(Lyrics)
      .findOneByOrFail({ id: match.lyricId! });
    return { lyricSnippet: lyric.lyricSnippet, deadline: match.deadline };
  }

  async guess(
    id: string,
    matchId: string,
    userId: string,
    guess: string,
  ): Promise<void> {
    const receivedAt = new Date();
    await this.db.transaction(async (manager) => {
      const tournament = await this.load(manager, id, true);
      const match = await this.activeMatch(
        manager,
        id,
        matchId,
        userId,
        receivedAt,
      );
      const lyric = await manager
        .getRepository(Lyrics)
        .findOneByOrFail({ id: match.lyricId! });
      const first = match.firstId === userId;
      if (first ? match.firstAt : match.secondAt)
        throw new ConflictException('Guess already submitted');
      const result = matchGuess(guess, lyric.songTitle, lyric.titleAliases);
      if (first) {
        await manager.query(
          'UPDATE tournament_matches SET "firstPoints" = $2, "firstAt" = $3 WHERE id = $1',
          [matchId, result.points, receivedAt],
        );
      } else {
        await manager.query(
          'UPDATE tournament_matches SET "secondPoints" = $2, "secondAt" = $3 WHERE id = $1',
          [matchId, result.points, receivedAt],
        );
      }
      await this.advance(manager, tournament);
    });
    await this.notify(id);
  }

  @Cron('*/5 * * * * *', { waitForCompletion: true })
  async processDue(): Promise<void> {
    const due = await this.db.query<Array<{ id: string }>>(
      `SELECT id FROM tournaments WHERE (status = 'registration' AND "startsAt" <= now())
       OR status = 'running' ORDER BY "startsAt", id`,
    );
    for (const { id } of due) {
      const changed = await this.db.transaction(async (manager) => {
        const tournament = await this.load(manager, id, true);
        if (tournament.status === 'registration') {
          if (await this.seed(manager, tournament)) {
            await this.advance(manager, tournament);
          }
          return true;
        }
        return (
          tournament.status === 'running' && this.advance(manager, tournament)
        );
      });
      if (changed) await this.notify(id);
    }
  }

  private async seed(
    manager: EntityManager,
    tournament: Tournament,
  ): Promise<boolean> {
    const entries = await this.entries(manager, tournament.id);
    if (entries.length < 2) {
      tournament.status = 'cancelled';
      await manager.query(
        "UPDATE tournaments SET status = 'cancelled' WHERE id = $1",
        [tournament.id],
      );
      return false;
    }
    const size = 2 ** Math.ceil(Math.log2(entries.length));
    let seeds = [1, 2];
    for (let count = 4; count <= size; count *= 2) {
      seeds = seeds.flatMap((seed) => [seed, count + 1 - seed]);
    }
    for (let count = size / 2, round = 1; count >= 1; count /= 2, round++) {
      for (let slot = 0; slot < count; slot++) {
        await manager.query(
          `INSERT INTO tournament_matches ("tournamentId", round, slot, "firstId", "secondId")
           VALUES ($1, $2, $3, $4, $5)`,
          [
            tournament.id,
            round,
            slot,
            round === 1 ? (entries[seeds[2 * slot] - 1]?.userId ?? null) : null,
            round === 1
              ? (entries[seeds[2 * slot + 1] - 1]?.userId ?? null)
              : null,
          ],
        );
      }
    }
    await manager.query(
      "UPDATE tournaments SET status = 'running' WHERE id = $1",
      [tournament.id],
    );
    tournament.status = 'running';
    return true;
  }

  private async advance(
    manager: EntityManager,
    tournament: Tournament,
  ): Promise<boolean> {
    const matches = await this.matches(manager, tournament.id);
    const rounds = new Map(
      matches.map((match) => [`${match.round}:${match.slot}`, match]),
    );
    let changed = false;
    for (const match of matches) {
      if (match.finishedAt) continue;
      if (match.round > 1) {
        const first = rounds.get(`${match.round - 1}:${2 * match.slot}`);
        const second = rounds.get(`${match.round - 1}:${2 * match.slot + 1}`);
        if (!first?.finishedAt || !second?.finishedAt) continue;
        match.firstId = first.winnerId;
        match.secondId = second.winnerId;
      }

      if (!match.firstId || !match.secondId) {
        await this.finish(manager, match, match.firstId ?? match.secondId);
      } else {
        await lockPlayerPair(manager, match.firstId, match.secondId);
        const blocked = await arePlayersBlocked(
          manager,
          match.firstId,
          match.secondId,
        );
        const active = await manager.query<Array<{ id: string }>>(
          'SELECT id FROM users WHERE id IN ($1, $2) AND "isActive"',
          [match.firstId, match.secondId],
        );
        if (blocked || active.length < 2) {
          // A block voids the pairing. Neither player advances because of a block.
          await this.finish(
            manager,
            match,
            blocked ? null : (active[0]?.id ?? null),
          );
        } else if (!match.deadline) {
          changed =
            (await this.openMatch(manager, tournament.id, match)) || changed;
          continue;
        } else if (
          (match.firstAt && match.secondAt) ||
          match.deadline <= new Date()
        ) {
          const first = match.firstPoints ?? 0;
          const second = match.secondPoints ?? 0;
          const firstTime = match.firstAt?.getTime() ?? Infinity;
          const secondTime = match.secondAt?.getTime() ?? Infinity;
          const firstWins =
            first > second || (first === second && firstTime <= secondTime);
          const winner =
            match.firstAt || match.secondAt
              ? firstWins
                ? match.firstId
                : match.secondId
              : null;
          await this.finish(manager, match, winner);
        } else {
          continue;
        }
      }

      changed = true;
      if (match === matches.at(-1)) {
        await manager.query(
          'UPDATE tournaments SET status = \'completed\', "winnerId" = $2 WHERE id = $1',
          [tournament.id, match.winnerId],
        );
      }
    }
    return changed;
  }

  private async openMatch(
    manager: EntityManager,
    tournamentId: string,
    match: Match,
  ): Promise<boolean> {
    const lyric = await manager
      .getRepository(Lyrics)
      .createQueryBuilder('lyric')
      .where('lyric.isActive = true')
      .addSelect(
        `CASE WHEN lyric.id IN (
         SELECT "lyricId" FROM tournament_matches WHERE "tournamentId" = :tournamentId
       ) THEN 1 ELSE 0 END`,
        'previously_used',
      )
      .setParameter('tournamentId', tournamentId)
      .orderBy('previously_used', 'ASC')
      .addOrderBy('random()')
      .limit(1)
      .getOne();
    if (!lyric) return false;

    const sessions = manager.getRepository(GameSession);
    const session = await sessions.save(
      sessions.create({
        player: { id: match.firstId! },
        playerTwoId: match.secondId!,
        mode: GameMode.MULTIPLAYER,
        category: GameCategory.POP,
        status: GameSessionStatus.IN_PROGRESS,
      }),
    );
    await manager.query(
      `UPDATE tournament_matches SET "firstId" = $2, "secondId" = $3,
       "sessionId" = $4, "lyricId" = $5, "deadline" = $6 WHERE id = $1`,
      [
        match.id,
        match.firstId,
        match.secondId,
        session.id,
        lyric.id,
        new Date(Date.now() + MATCH_WINDOW_MS),
      ],
    );
    return true;
  }

  private async finish(
    manager: EntityManager,
    match: Match,
    winnerId: string | null,
  ): Promise<void> {
    match.winnerId = winnerId;
    match.finishedAt = new Date();
    await manager.query(
      `UPDATE tournament_matches SET "firstId" = $2, "secondId" = $3,
       "winnerId" = $4, "finishedAt" = $5 WHERE id = $1`,
      [match.id, match.firstId, match.secondId, winnerId, match.finishedAt],
    );
    if (!match.sessionId) return;
    const sessions = manager.getRepository(GameSession);
    const session = await sessions.findOneBy({ id: match.sessionId });
    if (session)
      await sessions.save(
        Object.assign(session, {
          score: match.firstPoints ?? 0,
          playerTwoScore: match.secondPoints ?? 0,
          winnerId,
          completedAt: match.finishedAt,
          status: winnerId
            ? GameSessionStatus.COMPLETED
            : GameSessionStatus.ABANDONED,
        }),
      );
  }

  private async load(
    manager: EntityManager,
    id: string,
    lock = false,
  ): Promise<Tournament> {
    const [row] = await manager.query<Tournament[]>(
      lock
        ? 'SELECT * FROM tournaments WHERE id = $1 FOR UPDATE'
        : 'SELECT * FROM tournaments WHERE id = $1',
      [id],
    );
    if (!row) throw new NotFoundException('Tournament not found');
    return row;
  }

  private entries(
    manager: EntityManager,
    id: string,
  ): Promise<Array<{ userId: string }>> {
    return manager.query(
      'SELECT "userId" FROM tournament_entries WHERE "tournamentId" = $1 ORDER BY seed',
      [id],
    );
  }

  private matches(manager: EntityManager, id: string): Promise<Match[]> {
    return manager.query(
      'SELECT * FROM tournament_matches WHERE "tournamentId" = $1 ORDER BY round, slot',
      [id],
    );
  }

  private async activeMatch(
    manager: EntityManager,
    id: string,
    matchId: string,
    userId: string,
    at = new Date(),
  ): Promise<Match> {
    const [match] = await manager.query<Match[]>(
      `SELECT * FROM tournament_matches WHERE "tournamentId" = $1 AND id = $2
       AND $3 IN ("firstId", "secondId")`,
      [id, matchId, userId],
    );
    if (!match) throw new NotFoundException('Match not found');
    if (match.firstId && match.secondId) {
      await assertPlayersCanInteract(manager, match.firstId, match.secondId);
    }
    if (!match.deadline || at >= match.deadline || match.finishedAt)
      throw new ConflictException('Match is closed');
    return match;
  }

  private async notify(id: string): Promise<void> {
    const entries = await this.entries(this.db.manager, id);
    this.events.emit(RealtimeEvent.TOURNAMENT_BRACKET_UPDATED, {
      tournamentId: id,
      players: entries.map((entry) => entry.userId),
    });
  }
}
