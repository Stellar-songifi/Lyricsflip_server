export const MUSIC_TAXONOMY = {
  genres: ["pop", "rock", "hip-hop", "r-and-b", "country", "afrobeats", "gospel"],
  decades: ["1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"],
} as const;

export function normalizeGenre(value: string): string {
  return value.trim().toLowerCase().replace(/&/g, "and").replace(/\s+/g, "-");
}
