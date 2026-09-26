const ARTICLES = /^(a|an|the)\s+/i;

export function normalizeAnswer(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\b(feat|ft)\.?\b/gi, "featuring")
    .replace(ARTICLES, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

export function isLikelyAnswer(candidate: string, expected: string): boolean {
  return normalizeAnswer(candidate) === normalizeAnswer(expected);
}
