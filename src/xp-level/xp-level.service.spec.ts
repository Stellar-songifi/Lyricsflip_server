// xp-level.service.spec.ts
import { XpLevelService } from './xp-level.service';
import { UserLevel } from '../users/entities/user.entity';

describe('XpLevelService', () => {
  let service: XpLevelService;

  beforeEach(() => {
    service = new XpLevelService();
  });

  it('should start as Gossip Rookie', () => {
    expect(service.getLevelFromXp(0)).toBe(UserLevel.GOSSIP_ROOKIE);
  });

  it('should level up to Word Whisperer at 100 XP', () => {
    expect(service.getLevelFromXp(100)).toBe(UserLevel.WORD_WHISPERER);
  });

  it('should add XP correctly', () => {
    const result = service.calculateXpGain(90, 1);
    expect(result.xp).toBe(100);
    expect(result.level).toBe(UserLevel.WORD_WHISPERER);
  });
});
