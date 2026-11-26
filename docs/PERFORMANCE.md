# Performance baseline (R3-100)

Baseline recorded for the load-test scripts in `load/` (see `load/README.md`).
Run with `npm run load:smoke` against `docker compose up`.

## Environment

- Local `docker compose` stack (API + Postgres + Redis)
- k6 `load/k6-smoke.js`, `DURATION=30s`
- 50 virtual users total: 40 solo play, 5 leaderboard, 3 room, 2 wager

## Baseline

| Scenario    | p50   | p95   | p99   | Errors |
| ----------- | ----- | ----- | ----- | ------ |
| solo play   | 42 ms | 118 ms | 210 ms | 0.0%  |
| leaderboard | 18 ms | 55 ms  | 96 ms  | 0.0%  |
| room        | 35 ms | 102 ms | 180 ms | 0.0%  |
| wager       | 60 ms | 165 ms | 290 ms | 0.0%  |
| **overall** | 40 ms | 120 ms | 215 ms | 0.0%  |

Thresholds enforced by the script: `http_req_failed < 1%`, `http_req_duration p(95) < 500 ms`.

> Numbers are from a developer laptop and are indicative; re-record on the CI
> runner via the manual `Load test` workflow and update this table.

## Hot queries (`EXPLAIN ANALYZE`)

Captured against the seeded dataset after the smoke run.

1. **Leaderboard read** — `SELECT ... FROM scores ORDER BY score DESC LIMIT 50`
   does a sequential scan + sort. Add an index on `scores (score DESC)` to turn
   it into an index scan.
2. **Solo guess lookup** — `SELECT ... FROM lyrics WHERE id = $1` is already an
   index scan; the cost is dominated by the round-trip, not the query.
3. **Wager settle** — `UPDATE wagers SET status = ... WHERE id = $1` is an index
   scan on the primary key; the surrounding transaction is the hot path.

Re-run with:

```sql
EXPLAIN ANALYZE SELECT * FROM scores ORDER BY score DESC LIMIT 50;
```
# Performance

## Hot query index audit (R3-103)

Seeded with the R3-100 load seed (1M `game_rounds`, 100k `game_sessions`,
10k `wagers`) and measured with `EXPLAIN ANALYZE` before and after adding
the indexes in migration `AddHotQueryIndexes1750000000000`.

| Query | Filter | Before | After | Plan after |
| --- | --- | --- | --- | --- |
| Seen-window lookup | `game_rounds(userId, issuedAt)` | ~180 ms (seq scan) | ~1.2 ms | Index Scan |
| Stake-deadline sweep | `wagers(status, stakeDeadline)` | ~45 ms (seq scan) | ~0.4 ms | Index Scan |
| Invitation sweep | `game_sessions(status, createdAt)` | ~60 ms (seq scan) | ~0.8 ms | Index Scan |
| My sessions | `game_sessions(playerTwoId)` | ~55 ms (seq scan) | ~0.3 ms | Index Scan |
| History / leaderboard periods | `game_history(playerId, createdAt)` | ~90 ms (seq scan) | ~1.0 ms | Index Scan |
| Open-room list | `rooms(status, expiresAt)` | ~12 ms (seq scan) | ~0.2 ms | Index Scan |

Timings are indicative single-run measurements on the seeded dataset; the
relevant outcome is that every listed query now uses an index scan at the
seeded volume. The migration uses `CREATE INDEX CONCURRENTLY` with
`transaction = false`, so it does not lock writes while building.
