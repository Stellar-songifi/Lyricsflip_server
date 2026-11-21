import { ConfigService } from '@nestjs/config';

// cache-manager v7 takes TTLs in milliseconds. Every TTL here is suffixed
// with Ms so a value like `30` (30 ms, not 30 s) stands out in review.

// In-memory store capacity. Configurable via CACHE_MAX_ITEMS so the whole
// store is not capped at a tiny fixed size that evicts entries long before
// their TTL. Falls back to 5,000 when unset or invalid.
const DEFAULT_MAX_ITEMS = 5000;

function resolveMaxItems(configService: ConfigService): number {
  const raw = configService.get<string>('CACHE_MAX_ITEMS');
  if (!raw) {
    return DEFAULT_MAX_ITEMS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ITEMS;
}

export const cacheConfig = {
  // Default TTL for the global cache store (5 minutes)
  defaultTtlMs: 5 * 60 * 1000,

  // Single lyrics and lyrics-by-category (5 minutes)
  lyricsTtlMs: 5 * 60 * 1000,
  // Random lyrics are cached briefly so repeated requests still vary (75 s)
  randomLyricsTtlMs: 75 * 1000,
  // Search results (2.5 minutes)
  searchTtlMs: 150 * 1000,

  // Leaderboard pages (30 seconds)
  leaderboardTtlMs: 30 * 1000,

  // Maximum number of items in the in-memory cache (configurable).
  // Read through ConfigService so the value is validated at boot.
  getMaxItems(configService: ConfigService): number {
    return resolveMaxItems(configService);
  },

  // Cache key prefixes
  keys: {
    lyrics: 'lyrics:',
    randomLyrics: 'random_lyrics:',
    lyricsByCategory: 'lyrics_by_',
    search: 'lyrics_search_',
    // Security-sensitive SEP-10 nonces live in their own namespace so they
    // are not evicted alongside general cache entries.
    sep10Nonce: 'sep10_nonce:',
  },
};
