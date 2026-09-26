# Content Policy

This document describes how lyric content is sourced, attributed, and removed
from this project. It applies to all lyric data stored in the `lyrics`
collection and served through the API.

## Scope

The game only needs a short snippet of a song's lyrics plus answer metadata
(title, artist, etc.). Full lyric text is **not** required to play the game and
is **never served to players**.

## Sourcing

- Only submit content that you have the right to use, or that is covered by a
  valid license or an applicable exception (for example, fair use for short
  quotations).
- Prefer short, representative snippets (a maximum of 150 characters or two
  lines) rather than full verses or complete songs.
- Do not submit content obtained from unauthorized sources.

## Attribution

- Every snippet must be attributed to its original songwriter(s) and
  performer(s) where known.
- Include the song title and artist in the answer metadata so the source is
  clear to players.
- Do not remove or obscure existing attribution.

## Length Limits

- `lyricSnippet` is limited to **150 characters** (or two lines, whichever is
  shorter). Submissions that exceed this limit are rejected by validation.
- The optional `content` field, when present, is restricted to administrators
  and is never returned to players.

## Takedown Requests

If you are a rights holder and believe content in this project infringes your
copyright, please send a takedown request that includes:

1. Identification of the copyrighted work.
2. The exact location (URL, ID, or record) of the allegedly infringing content.
3. Your contact information.
4. A statement that you have a good-faith belief the use is unauthorized.
5. A statement, under penalty of perjury, that the information is accurate and
   that you are authorized to act on behalf of the rights holder.

We will review and remove qualifying content promptly.

## Enforcement

Content that violates this policy may be edited or removed without notice.
Repeated violations may result in loss of submission privileges.
