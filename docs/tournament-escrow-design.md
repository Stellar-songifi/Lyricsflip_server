# Tournament entry stakes

Issue #545 requires a single pot funded by tournament entrants. The existing
escrow contract stores a two-player pot keyed by game session. It accepts two
equal stakes and only allows settlement to one of those two players. Bracket
matches may have byes, and the tournament winner may come from any seeded
position. A series of two-player escrows cannot represent the promised pot or
give every entrant a claim against it.

A real-token tournament pot needs a contract change. Use a separate tournament
pot keyed by tournament ID and leave the existing match escrow path intact.
The tournament pot must record the token, entry amount, maximum entrants,
funding deadline, and settled state. Each wallet funds its own entry and may
fund it once. Lock the funded entrant set when registration closes and allow
settlement exactly once to a funded entrant. Cancellation and expiry require an
idempotent refund path for each funded entrant. The contract must enforce these
rules even if the API retries an operation.

The backend should lock registration against the finalized funded roster
before it seeds the bracket. Bracket games use ordinary unstaked head-to-head
sessions, since the entry stake is already held in the tournament pot. Record
and retry tournament settlement separately from bracket advancement so a
transaction failure cannot produce a second champion or a duplicate payout.
Free tournaments have no escrow activity.

## Free tournaments

The API accepts only free tournaments. It has no entry-stake field or token
transfer path. Real-token entries require the separate contract above.

Admins create a tournament with `POST /tournaments`. Authenticated players
enter through `POST /tournaments/:id/entries` before its UTC start time.
At that time the worker closes registration and opens the single-elimination
bracket. The first round is seeded by registration order, with byes assigned
to higher seeds. Each match is linked to a multiplayer game session.

Both players fetch the same snippet at `GET /tournaments/:id/matches/:matchId`
and submit a song title to its `/guess` endpoint. Each player has one attempt
and the deadline is set by the server. Scores and answers are hidden during
play. After both guesses or the deadline, the server advances the higher
score. A tied score goes to the earlier guess and then the first seat if both
timestamps are equal. Two no-shows or a blocked pairing advance neither
player. The worker retries opening a match if there are no active lyrics.

Registered players receive `tournament.bracket_updated` with the tournament
ID. They can read all completed match results from
`GET /tournaments/:id/bracket`.
