import { XpLevelService } from './xp-level.service';
import { UserLevel } from '../users/entities/user.entity';
import { Repository } from 'typeorm';

// The pure helpers (getLevelFromXp, calculateXpGain) do not touch the DB, so
// we pass a minimal mock repository to satisfy the constructor.
function makeService(): XpLevelService {
  const mockRepo = {} as jest.Mocked<Repository<any>>;
  return new XpLevelService(mockRepo);
}

describe('XpLevelService', () => {
  let service: XpLevelService;

  beforeEach(() => {
    service = new XpLevelService();
  });

  // -------------------------------------------------------------------------
  // getLevelFromXp — boundary tests for every threshold
  // -------------------------------------------------------------------------
  describe('getLevelFromXp', () => {
    it('returns level 1 / Gossip Rookie at 0 XP', () => {
      expect(service.getLevelFromXp(0)).toEqual({
        level: 1,
        levelTitle: UserLevel.GOSSIP_ROOKIE,
      });
    });

    it('stays at level 1 / Gossip Rookie at 99 XP (upper boundary)', () => {
      expect(service.getLevelFromXp(99)).toEqual({
        level: 1,
        levelTitle: UserLevel.GOSSIP_ROOKIE,
      });
    });

    it('advances to level 2 / Word Whisperer at 100 XP (lower boundary)', () => {
      expect(service.getLevelFromXp(100)).toEqual({
        level: 2,
        levelTitle: UserLevel.WORD_WHISPERER,
      });
    });

    it('stays at level 2 / Word Whisperer at 299 XP (upper boundary)', () => {
      expect(service.getLevelFromXp(299)).toEqual({
        level: 2,
        levelTitle: UserLevel.WORD_WHISPERER,
      });
    });

    it('advances to level 3 / Lyric Sniper at 300 XP (lower boundary)', () => {
      expect(service.getLevelFromXp(300)).toEqual({
        level: 3,
        levelTitle: UserLevel.LYRIC_SNIPER,
      });
    });

    it('stays at level 3 / Lyric Sniper at 599 XP (upper boundary)', () => {
      expect(service.getLevelFromXp(599)).toEqual({
        level: 3,
        levelTitle: UserLevel.LYRIC_SNIPER,
      });
    });

    it('advances to level 4 / Bar Genius at 600 XP (lower boundary)', () => {
      expect(service.getLevelFromXp(600)).toEqual({
        level: 4,
        levelTitle: UserLevel.BAR_GENIUS,
      });
    });

    it('stays at level 4 / Bar Genius at 999 XP (upper boundary)', () => {
      expect(service.getLevelFromXp(999)).toEqual({
        level: 4,
        levelTitle: UserLevel.BAR_GENIUS,
      });
    });

    it('advances to level 5 / Gossip Guru at 1000 XP (lower boundary)', () => {
      expect(service.getLevelFromXp(1000)).toEqual({
        level: 5,
        levelTitle: UserLevel.GOSSIP_GURU,
      });
    });

    it('stays at level 5 / Gossip Guru for very large XP values', () => {
      expect(service.getLevelFromXp(99999)).toEqual({
        level: 5,
        levelTitle: UserLevel.GOSSIP_GURU,
      });
    });
  });

  // -------------------------------------------------------------------------
  // calculateXpGain
  // -------------------------------------------------------------------------
  describe('calculateXpGain', () => {
    it('awards 10 XP per correct guess by default', () => {
      const result = service.calculateXpGain(0, 1);
      expect(result.xp).toBe(10);
    });

    it('triggers a level-up when crossing the 100 XP boundary', () => {
      // 90 XP + 1 correct guess (10 XP) = 100 XP → Word Whisperer
      const result = service.calculateXpGain(90, 1);
      expect(result.xp).toBe(100);
      expect(result.level).toBe(2);
      expect(result.levelTitle).toBe(UserLevel.WORD_WHISPERER);
    });

    it('handles multiple guesses at once', () => {
      const result = service.calculateXpGain(0, 5, 10);
      expect(result.xp).toBe(50);
      expect(result.level).toBe(1);
      expect(result.levelTitle).toBe(UserLevel.GOSSIP_ROOKIE);
    });

    it('supports a custom xpPerGuess value', () => {
      const result = service.calculateXpGain(0, 1, 300);
      expect(result.xp).toBe(300);
      expect(result.level).toBe(3);
      expect(result.levelTitle).toBe(UserLevel.LYRIC_SNIPER);
    });

    it('returns numeric level and levelTitle together', () => {
      const result = service.calculateXpGain(995, 1); // 995 + 10 = 1005
      expect(result.xp).toBe(1005);
      expect(result.level).toBe(5);
      expect(result.levelTitle).toBe(UserLevel.GOSSIP_GURU);
    });
  });
});
