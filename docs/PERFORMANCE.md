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
