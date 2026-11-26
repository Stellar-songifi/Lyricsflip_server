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
