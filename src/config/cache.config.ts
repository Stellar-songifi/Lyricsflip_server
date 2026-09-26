// cache-manager v7 takes TTLs in milliseconds. Every TTL here is suffixed
// with Ms so a value like `30` (30 ms, not 30 s) stands out in review.
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

  // Maximum number of items in cache
  maxItems: 100,

  // Cache key prefixes
  keys: {
    lyrics: 'lyrics:',
    randomLyrics: 'random_lyrics:',
    lyricsByCategory: 'lyrics_by_',
    search: 'lyrics_search_',
  },
};
