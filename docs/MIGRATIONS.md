# Database migrations

The schema is managed only by the TypeORM migrations in `src/migrations`
(`synchronize` is off). Running them in order on an empty PostgreSQL 14+
database produces exactly the schema the entities describe:

```bash
createdb lyricflip
npm run migration:run
npm run migration:check   # exits 1 if the entities and the database differ
```

The `Migrations` GitHub Actions workflow runs both commands against an empty
Postgres 14 on every push and pull request, so an entity change without a
matching migration fails CI. To add a migration, change the entity and run
`npm run migration:generate -- src/migrations/<Name>` against a database that
is up to date.

## Strategy: the existing chain was repaired in place

The chain could not build a fresh database. Rather than squashing it into a new
baseline, it was repaired in place, so databases that already record the
earlier migrations keep a valid history and nobody has to edit the
`migrations` table by hand:

- `CreateRoomsAndRoomUsers1691625843781` runs first, so it now enables the
  `uuid-ossp` extension (needed by every `uuid_generate_v4()` default). It no
  longer adds its foreign keys to `lyrics` and `users`, which did not exist yet.
- `RepairSchemaToMatchEntities1790363455031`, generated after running the rest
  of the chain on an empty database, creates `lyrics` and `game_history`, adds
  the missing `users` columns (`username`, `xp`, `level`, `levelTitle`,
  `lastLoginAt`, `role`, `isActive`), changes `room_users.userId` from `integer`
  to `uuid`, adds the missing foreign keys and renames hand-named constraints
  and indexes to the names TypeORM derives.

Enum types created by the migrations with a name other than TypeORM's default
(`game_category_enum`, `game_mode_enum`, `game_session_status_enum` and
`wager_status_enum`) are pinned with `enumName` on their entity columns. The
other enums use TypeORM's default `<table>_<column>_enum` names. Adding
`enumName` to those has no effect on the type name, but TypeORM 0.3 then
reports every such column as changed.

## Complete migration sequence

The canonical order of all migrations in `src/migrations/`:

```sql
INSERT INTO "migrations" ("timestamp", "name") VALUES
  (1691625843781, 'CreateRoomsAndRoomUsers1691625843781'),
  (1754625843781, 'CreateUsersTable1754625843781'),
  (1754625844000, 'CreateGameSessionsTable1754625844000'),
  (1754626322434, 'AddIndexToUserEmail1754626322434'),
  (1755000000000, 'AddUserPreferences1755000000000'),
  (1755077435852, 'AddMockTokenBalanceToUsers1755077435852'),
  (1755077436000, 'AddMultiplayerSupportToGameSessions1755077436000'),
  (1755077437000, 'CreateWagersTable1755077437000'),
  (1758800000000, 'AddCaseInsensitiveUniqueIndexToUsers1758800000000'),
  (1758900000000, 'AddSetNullToLyricsCreatedBy1758900000000'),
  (1759000000000, 'CreateRefreshTokensTable1759000000000'),
  (1759000000001, 'AddTokenVersionToUsers1759000000001'),
  (1788480000000, 'MigrateWagersToStellarEscrow1788480000000'),
  (1788490000000, 'CreateGameRoundsTable1788490000000'),
  (1790000000000, 'AddLatestStakeHashesToWagers1790000000000'),
  (1790000000001, 'CreateAuditLogsTable1790000000001'),
  (1790363455031, 'RepairSchemaToMatchEntities1790363455031'),
  (1790363500000, 'RenameGossipGodToGossipGuru1790363500000'),
  (1791000000000, 'AddStakeDeadlineToWagers1791000000000'),
  (1792000000000, 'AddTimedRoundsHintsAndDailyChallenges1792000000000'),
  (1793000000000, 'AddDifficultyConstraintAndDefault1793000000000'),
  (1793000000001, 'AddEmailVerificationAndPasswordReset1793000000001'),
  (1794000000000, 'AddRoomCodeHostAndLifecycle1794000000000'),
  (1794000000001, 'AddAliasesAndFixLyricsCreatedBy1794000000001'),
  (1794000000002, 'AddWagerSettlementIntent1794000000002'),
  (1794000000003, 'AlignAuthTokenTables1794000000003'),
  (1794000000004, 'AddResponsiblePlayColumnsToUsers1794000000004'),
  (1794000000005, 'CreateNotificationsTable1794000000005'),
  (1794000000006, 'AlignIndexNames1794000000006');
```

Every migration has its own timestamp. TypeORM orders migrations by it, so
two sharing one ran in file-system order and were recorded ambiguously.
`scripts/check-migration-location.sh` (the `Migration location` workflow) and
`src/migration-chain.spec.ts` fail when a timestamp is reused or a filename
prefix disagrees with its class name. Pick a timestamp later than every
existing one; `migration:generate` does this for you.

## Entity drift repaired in 1794000000000–1794000000006

Several entity changes were merged without migrations, so a database built
from the chain failed at the first query touching them (#358). Each of these
migrations is guarded (`IF NOT EXISTS`, or a check of the current type or
name), so it also brings a database built with `synchronize` in line:

| Migration | Brings in line |
|---|---|
| `AddRoomCodeHostAndLifecycle` | `rooms.code` (unique; existing rooms get a code), `hostId`, `maxPlayers`, `status` (closed rooms become `finished`), `startedAt`, `roundCount` |
| `AddAliasesAndFixLyricsCreatedBy` | `lyrics.artistAliases`, `titleAliases`; `createdById` nullable with ON DELETE SET NULL; the difficulty check under TypeORM's name |
| `AddWagerSettlementIntent` | `wagers.settlementKind`, `intendedWinnerId` |
| `AlignAuthTokenTables` | `refresh_tokens`, `email_tokens`, `password_reset_tokens`: `timestamptz`, TypeORM index and key names, `email_tokens.purpose` rewritten to `verify_email` |
| `AddResponsiblePlayColumnsToUsers` | `users.dailyStakeLimit`, `dailyStakeLimitEffectiveAt`, `selfExclusionEndsAt` |
| `CreateNotificationsTable` | `notifications` |
| `AlignIndexNames` | `audit_logs` index names; the `game_history (createdAt, playerId)` and `game_rounds (userId, issuedAt)` indexes |

Two earlier migrations failed on an empty database because they ran before
the table or column they change existed. They now skip that step, and a later
migration does it instead:

- `AddCaseInsensitiveUniqueIndexToUsers` skips the `username` index when
  `users.username` does not exist yet; `AddResponsiblePlayColumnsToUsers`
  creates it.
- `AddSetNullToLyricsCreatedBy` does nothing when `lyrics` does not exist yet;
  `AddAliasesAndFixLyricsCreatedBy` makes the change.

`src/lyrics/entities/lyric.entity.ts` was removed. It mapped a second entity,
with a uuid primary key, onto the same `lyrics` table, so `migration:check`
could never pass. Nothing imported it.

### Databases that ran a migration under its old name

`CreateAuditLogsTable` and `AddEmailVerificationAndPasswordReset` were renamed
to give them unique timestamps. On a database that already ran them under the
old name, `migration:run` sees the new name as pending and runs it again.
Both are idempotent, so this only records the new name next to the old one.
To keep the `migrations` table tidy instead, update the rows before running
the new migrations:

```sql
UPDATE "migrations"
SET "timestamp" = 1790000000001, "name" = 'CreateAuditLogsTable1790000000001'
WHERE "name" = 'CreateAuditLogsTable1790000000000';

UPDATE "migrations"
SET "timestamp" = 1793000000001, "name" = 'AddEmailVerificationAndPasswordReset1793000000001'
WHERE "name" = 'AddEmailVerificationAndPasswordReset1793000000000';
```

## Upgrading an existing database

Back the database up first (see [`BACKUP_STRATEGY.md`](BACKUP_STRATEGY.md)).

Run `npm run migration:run`. If you are bringing an existing database that was
bootstrapped with `synchronize` in line, run `npm run typeorm -- schema:log` to verify
the pending DDL, apply matching migrations, and mark them in `migrations` as shown above.
