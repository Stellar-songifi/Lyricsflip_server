export enum Genre {
  Afrobeats = "Afrobeats",
  HipHop = "Hip-Hop",
  Pop = "Pop",
  Other = "Other",
}

/**
 * Resolves a user-supplied genre to its canonical enum value, ignoring case
 * ("pop" -> Genre.Pop). Returns the input unchanged when nothing matches so
 * that validators such as @IsEnum can still reject it.
 */
export function toGenre(value: unknown): Genre | unknown {
  if (typeof value !== "string") return value
  const needle = value.trim().toLowerCase()
  const match = Object.values(Genre).find((g) => g.toLowerCase() === needle)
  return match ?? value.trim()
}

export function isGenre(value: unknown): value is Genre {
  return Object.values(Genre).includes(value as Genre)
}
