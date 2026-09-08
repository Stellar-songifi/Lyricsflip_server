# LyricsFlip — Server

Backend for LyricsFlip, a lyrics-guessing game: players are shown a snippet of
a song and guess the artist or the title. Matches can be played solo, in a
shared room, or head-to-head for a stake — and staked matches settle either as
Postgres balances or through a Soroban escrow contract on Stellar.

Built with [NestJS](https://nestjs.com) 11, TypeORM + PostgreSQL, Socket.IO and
the [Stellar SDK](https://stellar.github.io/js-stellar-sdk/).

---

## Contents

- [How the game works](#how-the-game-works)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [API overview](#api-overview)
- [Wagers and settlement](#wagers-and-settlement)
- [The escrow contract](#the-escrow-contract)
- [Testing](#testing)
- [Project layout](#project-layout)
- [Further documentation](#further-documentation)

---

## How the game works

A **lyric** is a snippet with an artist, song title, genre and decade. Players
guess either the `artist` or the `songTitle`; guesses are matched fuzzily
(`string-similarity`), so a near-miss can still score a partial match.

| Outcome               | Points         |
| --------------------- | -------------- |
| Correct guess         | 100            |
| Partial match         | 50             |
| Streak bonus          | 25             |
| Difficulty multiplier | ×1 / ×1.5 / ×2 |

Correct guesses earn XP, and XP moves the player through five levels:

| XP      | Level          |
| ------- | -------------- |
| 0–99    | Gossip Rookie  |
| 100–299 | Word Whisperer |
| 300–599 | Lyric Sniper   |
| 600–999 | Bar Genius     |
| 1000+   | Gossip Guru    |

Three ways to play:

- **Solo** — `GET /game/lyric` for a snippet, `POST /game/guess` to answer.
- **Rooms** — a shared lyric with an expiry; everyone in the room guesses and
  is scored against the same snippet.
- **Head-to-head sessions** — two players, one `GameSession`, optionally with a
  wager on the outcome.

Every guess is written to `game_history`, which backs per-player stats and the
leaderboard.

## Architecture

A single NestJS application. `JwtAuthGuard` and `RolesGuard` are registered
globally (`APP_GUARD`), so **every route requires a bearer token unless it is
marked `@Public()`**, and admin routes additionally carry `@Roles(Role.Admin)`.

| Module          | Responsibility                                                      |
| --------------- | ------------------------------------------------------------------- |
| `auth`          | Signup/login, JWT issuance, and SEP-10 wallet authentication        |
| `users`         | Accounts, profiles, preferences, leaderboard query                  |
| `lyrics`        | Lyric CRUD, filtered/random lookup, and the cache layer over it     |
| `game`          | Solo play — serve a lyric, score a guess (HTTP + `/game` WebSocket) |
| `game-logic`    | Guess matching and point calculation                                |
| `game-sessions` | Head-to-head sessions, including wagered ones                       |
| `game-history`  | Per-guess audit trail and player statistics                         |
| `rooms`         | Shared-lyric rooms with expiry and per-player guesses               |
| `tokens`        | Wager lifecycle; picks a settlement backend at boot                 |
| `stellar`       | Config, Soroban RPC, escrow invocation, key storage                 |
| `xp-level`      | XP thresholds and level titles                                      |
| `notifications` | In-memory, event-emitter–driven notifications                       |
| `admin`         | Admin-only user and lyric management                                |
| `common`        | Logging and error interceptors, Winston logger                      |

Two cross-cutting details worth knowing before reading the code:

- **The database is configured for read/write splitting.** TypeORM is set up
  with a `master` plus one replica; if the `DB_REPLICA_*` variables are unset
  the replica falls back to the primary, so a single-database setup works
  unchanged. `synchronize` is `false` — schema changes go through migrations.
- **Caching is global.** `CacheModule` is registered app-wide with the TTL and
  size from `src/config/cache.config.ts` (5 minutes, 100 entries); the lyrics
  service caches reads and invalidates on write.

## Getting started

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- For contract work only: Rust with the `wasm32-unknown-unknown` target
  (`rustup target add wasm32-unknown-unknown`), and optionally the
  [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli)
  for deploying

### Install and configure

```bash
npm install
cp .env.example .env    # then edit — at minimum the DB_* and JWT_SECRET values
```

Create the database, then run the migrations:

```bash
createdb lyricflip
npm run migration:run
```

`npm run seed` loads sample lyrics and users, but **does not currently
compile**: `src/seeds/seed.ts` imports `Genre` from `lyrics.entity`, which
declares it in `entities/genre.enum.ts` and does not re-export it. The same
missing export breaks several older specs — see [Testing](#testing).

### Run

```bash
npm run start:dev       # watch mode
npm run start:prod      # after npm run build
```

The API listens on `PORT` (default 3000) and Swagger UI is served at
`/api/docs`.

## Configuration

Environment variables are read from `.env`. `.env.example` documents all of
them; the ones you cannot skip:

| Variable                                                      | Purpose                                                                |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` | Primary database. Boot fails if any is missing.                        |
| `DB_REPLICA_*`                                                | Optional read replica; each value defaults to its primary counterpart. |
| `JWT_SECRET`, `JWT_EXPIRES_IN`                                | Token signing.                                                         |
| `PORT`, `FRONTEND_URL`, `NODE_ENV`                            | HTTP port, CORS origin, environment.                                   |

Everything Stellar-related is prefixed `STELLAR_`. The default,
`STELLAR_SETTLEMENT_MODE=mock`, needs no other Stellar variable — the rest are
only read in `stellar` mode, and are validated at boot so that a malformed
contract ID fails the deploy instead of a live transaction. See
[Wagers and settlement](#wagers-and-settlement).

## API overview

Full request/response detail lives in Swagger at `/api/docs`. `[public]` marks
routes that skip the global auth guard; `[admin]` marks routes that require the
admin role.

**Auth** — `/auth`

| Route                                     | Purpose                                |
| ----------------------------------------- | -------------------------------------- |
| `POST /auth/signup` `[public]`            | Create an account                      |
| `POST /auth/login` `[public]`             | Email + password → JWT                 |
| `POST /auth/stellar/challenge` `[public]` | Request a SEP-10 challenge to sign     |
| `POST /auth/stellar/login` `[public]`     | Signed challenge → JWT                 |
| `POST /auth/stellar/link`                 | Link a wallet to the signed-in account |
| `GET`/`DELETE /auth/stellar/wallet`       | Read or unlink the linked wallet       |

**Gameplay** — `/game`, `/rooms`, `/game-sessions`

| Route                                                    | Purpose                                       |
| -------------------------------------------------------- | --------------------------------------------- |
| `GET /game/lyric`, `GET /game/lyrics/multiple`           | Fetch snippets to guess                       |
| `POST /game/guess`                                       | Submit a guess, get scoring back              |
| `GET /game/stats`, `GET /game/health`                    | Game statistics and health                    |
| `POST /rooms/create`, `POST /rooms/:roomId/join`         | Shared-lyric rooms                            |
| `GET /rooms/:roomId/status`, `POST /rooms/:roomId/guess` | Room state and play                           |
| `POST`/`GET`/`PATCH`/`DELETE /game-sessions`             | Session CRUD                                  |
| `GET /game-sessions/top-scores`, `/my-recent`            | Session listings                              |
| `PUT /game-sessions/:id/complete-wagered`                | Finish a staked match and settle it           |
| `GET /game-sessions/tokens/balance`                      | Token balance, in base units and display form |
| `GET /game-sessions/:id/wager`, `/wagers/my-history`     | Wager state and history                       |

**Content and accounts** — `/lyrics`, `/users`, `/game-history`, `/admin`

| Route                                                               | Purpose                     |
| ------------------------------------------------------------------- | --------------------------- |
| `GET /lyrics`, `/lyrics/:id`, `/lyrics/random`                      | Read lyrics                 |
| `GET /lyrics/genre/:genre`, `/decade/:decade`, `/artist/:artist`    | Filtered reads (cached)     |
| `POST`/`PATCH`/`DELETE /lyrics/:id` `[admin]`                       | Manage lyrics               |
| `POST /lyrics/cache/clear`, `GET /lyrics/cache/stats` `[admin]`     | Cache control               |
| `GET /users/profile`, `GET`/`PATCH /users/preferences`              | Own profile and preferences |
| `GET /game-history/me`, `/me/stats`, `/:id`, `/users/:userId`       | History and stats           |
| `GET`/`DELETE /admin/users`, `GET`/`DELETE /admin/lyrics` `[admin]` | Administration              |

**Notifications** — `/notifications`

| Route                                                          | Purpose                   |
| -------------------------------------------------------------- | ------------------------- |
| `GET /notifications`, `GET /notifications/user/:userId`        | Read notifications        |
| `DELETE /notifications`                                        | Clear the in-memory store |
| `POST /notifications/mock-*`, `/test/*`, `/generate-mock-data` | Emit sample events        |

Notifications are held in memory and emitted through `@nestjs/event-emitter`;
nothing is persisted, so the store empties on restart.

**Stellar** — `/stellar`

| Route                            | Purpose                                           |
| -------------------------------- | ------------------------------------------------- |
| `GET /stellar/info` `[public]`   | Network, contract IDs, resolver address, decimals |
| `GET /stellar/health` `[public]` | Whether the configured Soroban RPC is reachable   |

**WebSocket** — namespace `/game`, events `requestLyric`, `submitGuess`,
`getSession`.

## Wagers and settlement

A wagered session escrows an equal stake from both players and pays the whole
pot to the winner. Amounts are handled in **stroops** — 7 decimal places, the
Stellar convention — and are carried as strings (`"1000000000"` = 100 LYRIC) so
no amount ever passes through a float.

Two axes control how this behaves, both set by environment variable and both
resolved once at boot:

**`STELLAR_SETTLEMENT_MODE`** decides which `ITokenService` the `TOKEN_SERVICE`
provider resolves to:

- `mock` (default) — balances are a column on `users`; no network calls. This
  is what tests and local development run on.
- `stellar` — stakes and payouts are real Soroban contract invocations.

**`STELLAR_CUSTODY_MODE`** decides who signs a player's stake:

- `non-custodial` (default) — the backend builds the transaction and returns
  unsigned XDR for the player's wallet (Freighter, xBull, Albedo) to sign.
- `custodial` — the backend derives and holds player keys and signs for them.
  Convenient for testnet demos. Combining this with `STELLAR_NETWORK=public` is
  refused at boot, because it would let the backend move real player funds.

A wager row moves through `pending → awaiting_stakes → staked → settling →
won | refunded`, with `failed` for settlement that needs operator attention.

Two pieces of that flow are not reachable over HTTP yet, which matters if you
are wiring up a client: `WagerService.confirmStake` — where a wallet returns
its signed stake XDR — has no controller route, and `UsersService.getLeaderboard`
is likewise service-only. Both are exercised by unit tests but not exposed.

The rule the wager service exists to enforce: **no network call happens inside
a database transaction.** A Postgres rollback cannot un-submit a Stellar
transaction, so each step commits its intent, makes the network call outside
any transaction, then commits the observed outcome. A crash in between leaves a
row in `settling` carrying a transaction hash, which `reconcileWager` can
resolve against the ledger rather than guessing.

## The escrow contract

`contracts/lyricsflip-escrow` is a Soroban contract holding one _pot_ per game
session, keyed by the 16 bytes of the session UUID.

```
initialize(admin, token, resolver)               set once at deploy
open_pot(session_id, player_a, player_b, stake)  resolver only
stake(session_id, player)                        player authorises their own transfer
resolve(session_id, winner)                      resolver only; winner must be a player
refund(session_id)                               resolver only; returns each stake
set_resolver(new_resolver)                       admin only
get_pot / get_config                             reads
```

The resolver key can pick the winner, but nothing more: `resolve` only pays an
address that is a player in that pot, and `refund` only returns each stake to
whoever made it. That bounds the damage from a compromised backend key to
choosing wrongly, rather than draining escrow. Rotating the resolver is an
`admin` action, intended to be held by a multisig.

```bash
cd contracts
cargo test                                              # 11 tests
cargo build --target wasm32-unknown-unknown --release   # or: stellar contract build
```

soroban-sdk 22 builds against `wasm32-unknown-unknown`; the wasm lands in
`contracts/target/wasm32-unknown-unknown/release/lyricsflip_escrow.wasm`.

Release profile settings live in the **workspace** `Cargo.toml` — Cargo ignores
`[profile.release]` in a member crate, so they must not be moved back down into
`lyricsflip-escrow/`.

## Testing

```bash
npm test                 # unit tests
npm run test:cov         # with coverage
npm run test:e2e         # end-to-end (test/, needs a database)
cd contracts && cargo test
```

Jest compiles specs with `tsconfig.test.json`, which is looser than the build
config so that fixtures need not satisfy every entity field.

**Known state:** 21 suites pass and 12 fail. Every failure predates the Stellar
work and is a type error in an old scaffold spec rather than a product bug:

- `Genre` is not exported from `lyrics.entity` — the same break that stops
  `npm run seed` compiling (`lyrics`, `rooms`, `seeds`, `game` specs)
- `game.service` no longer exports `GameService`
- `xp-level.service.spec` imports `../user/user.entity`, which does not exist
- `UsersController` has no `getLeaderboard`, and there is no `leaderboard.controller.ts`
  behind `leaderboard.controller.spec.ts`

`npx tsc -p tsconfig.test.json --noEmit` lists them all. The auth, stellar,
tokens, game-session, notification and common suites are green.

## Project layout

```
src/
  auth/          JWT + SEP-10 wallet authentication, guards, decorators
  users/         accounts, preferences, leaderboard
  lyrics/        lyric CRUD and cached lookups
  game/          solo play, HTTP + WebSocket gateway
  game-logic/    guess matching and scoring
  game-sessions/ head-to-head sessions, wagered completion
  game-history/  per-guess history and stats
  rooms/         shared-lyric rooms
  tokens/        wager lifecycle; mock and Stellar token services
  stellar/       config, Soroban RPC, escrow invocation, key store
  xp-level/      XP thresholds and level titles
  notifications/ event-emitter notifications (in memory)
  admin/         admin-only management endpoints
  common/        interceptors and logging
  config/        cache configuration
  migrations/    TypeORM migrations
  seeds/         database seeding
contracts/
  lyricsflip-escrow/   Soroban escrow contract (Rust)
test/            end-to-end specs
docs/            operational documentation
```

Migrations:

```bash
npm run migration:run                                 # apply pending
npm run migration:generate -- src/migrations/<Name>   # create from entity diff
npm run migration:revert                              # roll back the last one
```

## Further documentation

- [`docs/CACHING_IMPLEMENTATION.md`](docs/CACHING_IMPLEMENTATION.md) — cache keys, TTLs, invalidation
- [`docs/DATABASE_MONITORING.md`](docs/DATABASE_MONITORING.md) — slow-query logging and monitoring
- [`docs/BACKUP_STRATEGY.md`](docs/BACKUP_STRATEGY.md) — backup and restore
- [`docs/DATA_ARCHIVING.md`](docs/DATA_ARCHIVING.md) — archiving old data
- [`src/notifications/README.md`](src/notifications/README.md) — notification events and payloads
- `.env.example` — every environment variable, with the Stellar ones annotated
