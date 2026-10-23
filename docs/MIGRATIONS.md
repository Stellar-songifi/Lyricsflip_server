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
  (1790000000000, 'CreateAuditLogsTable1790000000000'),
  (1790363455031, 'RepairSchemaToMatchEntities1790363455031'),
  (1790363500000, 'RenameGossipGodToGossipGuru1790363500000'),
  (1791000000000, 'AddStakeDeadlineToWagers1791000000000'),
  (1792000000000, 'AddTimedRoundsHintsAndDailyChallenges1792000000000'),
  (1793000000000, 'AddDifficultyConstraintAndDefault1793000000000'),
  (1793000000000, 'AddEmailVerificationAndPasswordReset1793000000000');
```

## Upgrading an existing database

For the load balancer and server timeout settings that accompany the app (see
`src/main.ts`), see the deployment notes in the README; the key rule is that the
load balancer's idle timeout must be shorter than the app's `keepAliveTimeout`
(default 65 s, longer than the AWS ALB default of 60 s).

Back the database up first (see [`BACKUP_STRATEGY.md`](BACKUP_STRATEGY.md)).

Run `npm run migration:run`. If you are bringing an existing database that was
bootstrapped with `synchronize` in line, run `npm run typeorm -- schema:log` to verify
the pending DDL, apply matching migrations, and mark them in `migrations` as shown above.
