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

## Source and Rights Records

Every lyric records where it came from, so that everything from one source can
be found, and removed, if its rights holder objects:

| Field       | Required | Meaning                                                              |
| ----------- | -------- | -------------------------------------------------------------------- |
| `source`    | Yes      | Where the snippet came from, e.g. `artist-submission`, `licensed:acme-music`. Stored lower-case. |
| `sourceUrl` | No       | Link to the source.                                                  |
| `licence`   | No       | Licence or agreement the snippet is used under, or `fair-use-quote`. |
| `addedBy`   | Auto     | Id of the admin who added it, or `seed`.                             |

`source` is required both when creating a lyric through the API and on every
row of a CSV or JSON import. Lyrics that existed before these fields were added
have `source = unknown`; filter on it (`GET /admin/lyrics?source=unknown`) to
find rows that still need a source recorded.

Full lyric text is **not stored**. `content` may still be sent when creating a
lyric, but only to derive `lyricSnippet` when no snippet is given; it is then
discarded.

## Attribution

- Every snippet must be attributed to its original songwriter(s) and
  performer(s) where known.
- Include the song title and artist in the answer metadata so the source is
  clear to players.
- Do not remove or obscure existing attribution.

## Length Limits

- `lyricSnippet` is limited to **150 characters** (or two lines, whichever is
  shorter). Submissions that exceed this limit are rejected by validation.
- Full lyric text (`content`) is not stored; see Source and Rights Records.

## Takedown Requests

If you are a rights holder and believe content in this project infringes your
copyright, please send a takedown request that includes:

1. Identification of the copyrighted work.
2. The exact location (URL, ID, or record) of the allegedly infringing content.
3. Your contact information.
4. A statement that you have a good-faith belief the use is unauthorized.
5. A statement, under penalty of perjury, that the information is accurate and
   that you are authorized to act on behalf of the rights holder.

We will review and remove qualifying content promptly. When a request covers
everything from one source, an admin deactivates it in one action with
`POST /admin/lyrics/sources/:source/deactivate`, which is recorded in the
audit log and returns the ids of the lyrics it deactivated.

## Enforcement

Content that violates this policy may be edited or removed without notice.
Repeated violations may result in loss of submission privileges.
