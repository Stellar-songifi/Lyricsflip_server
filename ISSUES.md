# LyricsFlip Server: Issue Backlog

This backlog comes from a full read of the codebase: every module in `src/`, the migrations, the Soroban escrow contract in `contracts/`, and the test suite (34 suites and 409 tests, all passing at the time of writing). Each issue names the files involved and gives the problem, tasks, and acceptance criteria, so it can be copied into GitHub as it is.

Issues marked as bugs were found by reading the code and, where possible, confirmed by compiling or running it. Line numbers refer to the current `main` branch and will drift as fixes land.

## How to use this file

- **Priority:** P0 means broken, unsafe, or blocking release. P1 is high, P2 medium, P3 nice to have.
- **Difficulty:** Easy is under a day for someone new to the codebase. Medium is one to three days. Hard involves a design decision or several modules.
- **Labels** are suggestions for GitHub labels. Issues tagged `good first issue` are self-contained and suit new contributors.
- **On GitHub**, every item is published as an issue titled `[N] …`, where `N` is its number here. GitHub's own numbers are offset by 86: item 1 is [#87](https://github.com/Stellar-songifi/Lyricsflip_server/issues/87) and item 125 is [#211](https://github.com/Stellar-songifi/Lyricsflip_server/issues/211).
- Each issue has a **Tasks** checklist for how to do the work and an **Acceptance criteria** checklist for when it is done. Cross-references such as "issue #36" use the numbers in this file.

## Summary

| Priority | Count |  | Difficulty | Count |
| --- | --- | --- | --- | --- |
| P0 | 15 |  | Easy | 58 |
| P1 | 33 |  | Medium | 59 |
| P2 | 50 |  | Hard | 8 |
| P3 | 27 |  |  |  |

**125 issues** in total, **19** of them tagged `good first issue`.

| Section | Issues |
| --- | --- |
| Critical bugs and boot blockers | #1–#26 (26) |
| Security and authorization | #27–#50 (24) |
| Stellar, wagers and the escrow contract | #51–#75 (25) |
| Gameplay | #76–#97 (22) |
| Lyrics content management | #98–#104 (7) |
| Users and accounts | #105–#110 (6) |
| Infrastructure, DevOps and developer experience | #111–#125 (15) |

### Suggested order of work

1. **Make it run and make it safe:** #1–#4, #7, #8, #9, #27–#31. These are boot blockers, schema breakage, and holes that let players take or lose funds.
2. **Make settlement trustworthy:** #10, #11, #32, #51–#53, #56, #58, #59, #67.
3. **Make the game real:** #78–#81 and #83–#84. XP, history and scoring need to exist before any growth features.
4. **Everything else**, alongside the infrastructure work: #111, #112, and #119 first.

## Index

| # | Title | Priority | Difficulty | Labels |
| --- | --- | --- | --- | --- |
| 1 | [`LyricsController` cannot be constructed because `LyricsService` is imported with `import type`](#1-lyricscontroller-cannot-be-constructed-because-lyricsservice-is-imported-with-import-type) | P0 | Easy | bug critical lyrics |
| 2 | [`POST /lyrics` and `PATCH /lyrics/:id` ignore the request body (missing `@Body()`)](#2-post-lyrics-and-patch-lyricsid-ignore-the-request-body-missing-body) | P0 | Easy | bug critical lyrics admin |
| 3 | [`@GetUser('id')` returns the whole `User` object, which breaks every rooms endpoint](#3-getuserid-returns-the-whole-user-object-which-breaks-every-rooms-endpoint) | P0 | Easy | bug critical rooms auth |
| 4 | [A fresh database cannot be built from the migrations](#4-a-fresh-database-cannot-be-built-from-the-migrations) | P0 | Hard | bug critical database migrations |
| 5 | [Stray migration file at the repository root](#5-stray-migration-file-at-the-repository-root) | P1 | Easy | bug database migrations good first issue |
| 6 | [Level-title enum mismatch: `'Gossip God'` vs `'Gossip Guru'`](#6-level-title-enum-mismatch-gossip-god-vs-gossip-guru) | P1 | Easy | bug database users good first issue |
| 7 | [`room_users.userId` is created as `integer`, but `users.id` is a UUID](#7-room_usersuserid-is-created-as-integer-but-usersid-is-a-uuid) | P0 | Easy | bug database rooms |
| 8 | [A wager becomes `STAKED` after only one player signs their stake](#8-a-wager-becomes-staked-after-only-one-player-signs-their-stake) | P0 | Medium | bug critical stellar wagers security |
| 9 | [Reconciliation records interrupted payouts as refunds](#9-reconciliation-records-interrupted-payouts-as-refunds) | P0 | Medium | bug critical stellar wagers |
| 10 | [`complete-wagered` marks the session completed even when settlement fails](#10-complete-wagered-marks-the-session-completed-even-when-settlement-fails) | P0 | Medium | bug critical game-sessions wagers |
| 11 | [Mock settlement pots live in memory and are lost on restart](#11-mock-settlement-pots-live-in-memory-and-are-lost-on-restart) | P1 | Medium | bug wagers mock-mode |
| 12 | [CORS is enabled after the server starts listening](#12-cors-is-enabled-after-the-server-starts-listening) | P1 | Easy | bug http good first issue |
| 13 | [`GameGateway` is not registered in any module, so the WebSocket API does not exist](#13-gamegateway-is-not-registered-in-any-module-so-the-websocket-api-does-not-exist) | P1 | Easy | bug websocket game |
| 14 | [Creating lyrics fails because `lyricSnippet` is required but never supplied](#14-creating-lyrics-fails-because-lyricsnippet-is-required-but-never-supplied) | P0 | Easy | bug lyrics database |
| 15 | [Seed script creates a non-admin "admin", hardcodes a password, and inserts invalid rows](#15-seed-script-creates-a-non-admin-admin-hardcodes-a-password-and-inserts-invalid-rows) | P1 | Easy | bug seed dx |
| 16 | [`game-logic` module is dead code with a level-type bug and a clashing class name](#16-game-logic-module-is-dead-code-with-a-level-type-bug-and-a-clashing-class-name) | P2 | Easy | bug refactor xp |
| 17 | [Genre filters on `/game/*` crash in Postgres (`lower(enum)` does not exist)](#17-genre-filters-on-game-crash-in-postgres-lowerenum-does-not-exist) | P1 | Easy | bug game database |
| 18 | [Gameplay serves and scores soft-deleted lyrics](#18-gameplay-serves-and-scores-soft-deleted-lyrics) | P1 | Easy | bug game lyrics |
| 19 | [Expired rooms are never closed](#19-expired-rooms-are-never-closed) | P2 | Easy | bug rooms |
| 20 | [`CreateRoomDto.lyricId` is validated as a UUID, but lyric IDs are integers](#20-createroomdtolyricid-is-validated-as-a-uuid-but-lyric-ids-are-integers) | P2 | Easy | bug rooms validation good first issue |
| 21 | [Room guesses are scored against the full lyric text, and room status leaks the answers](#21-room-guesses-are-scored-against-the-full-lyric-text-and-room-status-leaks-the-answers) | P1 | Medium | bug rooms gameplay security |
| 22 | [Leaderboard is cached for 30 milliseconds, not 30 seconds](#22-leaderboard-is-cached-for-30-milliseconds-not-30-seconds) | P2 | Easy | bug performance users good first issue |
| 23 | [Lyrics cache invalidation is a no-op, so edits are served stale](#23-lyrics-cache-invalidation-is-a-no-op-so-edits-are-served-stale) | P1 | Medium | bug caching lyrics |
| 24 | [`GET /lyrics/:id` does not parse or validate the ID](#24-get-lyricsid-does-not-parse-or-validate-the-id) | P3 | Easy | bug lyrics validation good first issue |
| 25 | [Query parameters (`limit`, `offset`, `count`) are unvalidated strings](#25-query-parameters-limit-offset-count-are-unvalidated-strings) | P2 | Easy | bug validation |
| 26 | [Password login lets deactivated users in and signs the JWT twice](#26-password-login-lets-deactivated-users-in-and-signs-the-jwt-twice) | P2 | Easy | bug auth good first issue |
| 27 | [Password hashes are returned in API responses](#27-password-hashes-are-returned-in-api-responses) | P0 | Medium | security critical users |
| 28 | [Any logged-in user can update or delete any other user](#28-any-logged-in-user-can-update-or-delete-any-other-user) | P0 | Easy | security critical users |
| 29 | [Game sessions can be read, edited and deleted by anyone](#29-game-sessions-can-be-read-edited-and-deleted-by-anyone) | P0 | Medium | security critical game-sessions |
| 30 | [Any user can decide the winner of a wagered match by posting scores](#30-any-user-can-decide-the-winner-of-a-wagered-match-by-posting-scores) | P0 | Hard | security critical wagers stellar |
| 31 | [Player two is enrolled in a wager, and debited, without consenting](#31-player-two-is-enrolled-in-a-wager-and-debited-without-consenting) | P0 | Hard | security critical wagers |
| 32 | [`confirmStake` submits whatever signed XDR the client sends](#32-confirmstake-submits-whatever-signed-xdr-the-client-sends) | P1 | Medium | security stellar wagers |
| 33 | [Game history of any user is readable by any user](#33-game-history-of-any-user-is-readable-by-any-user) | P1 | Easy | security game-history privacy |
| 34 | [Notification endpoints are open to every user](#34-notification-endpoints-are-open-to-every-user) | P1 | Easy | security notifications |
| 35 | [Players can read the answers from `/lyrics` endpoints](#35-players-can-read-the-answers-from-lyrics-endpoints) | P1 | Medium | security gameplay lyrics |
| 36 | [Guesses are not tied to a served round, so answers can be replayed and farmed](#36-guesses-are-not-tied-to-a-served-round-so-answers-can-be-replayed-and-farmed) | P1 | Hard | security gameplay |
| 37 | [WebSocket gateway accepts every origin and has no authentication](#37-websocket-gateway-accepts-every-origin-and-has-no-authentication) | P1 | Medium | security websocket |
| 38 | [No rate limiting on authentication, guessing or SEP-10](#38-no-rate-limiting-on-authentication-guessing-or-sep-10) | P1 | Easy | security http |
| 39 | [Add standard security headers (Helmet)](#39-add-standard-security-headers-helmet) | P2 | Easy | security http good first issue |
| 40 | [SEP-10 challenges can be replayed, and production silently uses an ephemeral key](#40-sep-10-challenges-can-be-replayed-and-production-silently-uses-an-ephemeral-key) | P1 | Medium | security stellar auth |
| 41 | [Add refresh tokens, logout and token revocation](#41-add-refresh-tokens-logout-and-token-revocation) | P2 | Medium | security auth feature |
| 42 | [Log redaction is shallow and misses nested secrets and signed XDR](#42-log-redaction-is-shallow-and-misses-nested-secrets-and-signed-xdr) | P2 | Easy | security logging |
| 43 | [Enforce password strength and normalize emails and usernames](#43-enforce-password-strength-and-normalize-emails-and-usernames) | P2 | Easy | security auth validation good first issue |
| 44 | [Deleting a user destroys the lyric catalogue and financial history](#44-deleting-a-user-destroys-the-lyric-catalogue-and-financial-history) | P1 | Medium | security data-integrity admin |
| 45 | [Add a KMS or Vault implementation of `IKeyStore`](#45-add-a-kms-or-vault-implementation-of-ikeystore) | P2 | Hard | security stellar feature |
| 46 | [Validate the full environment at boot and clean up `.env.example`](#46-validate-the-full-environment-at-boot-and-clean-up-envexample) | P2 | Easy | security config dx |
| 47 | [Replace `ErrorInterceptor` with a global exception filter](#47-replace-errorinterceptor-with-a-global-exception-filter) | P2 | Medium | refactor security http |
| 48 | [Add audit logging for admin and settlement actions](#48-add-audit-logging-for-admin-and-settlement-actions) | P2 | Medium | security admin wagers |
| 49 | [Block wallet unlinking while the user has an active wager](#49-block-wallet-unlinking-while-the-user-has-an-active-wager) | P2 | Easy | security stellar wagers |
| 50 | [Sanitize user-controlled strings before they appear in messages and logs](#50-sanitize-user-controlled-strings-before-they-appear-in-messages-and-logs) | P3 | Easy | security good first issue |
| 51 | [Players cannot get a fresh stake transaction after the first one expires](#51-players-cannot-get-a-fresh-stake-transaction-after-the-first-one-expires) | P1 | Medium | stellar wagers feature |
| 52 | [Refund wagers automatically when a player never stakes](#52-refund-wagers-automatically-when-a-player-never-stakes) | P1 | Medium | stellar wagers feature |
| 53 | [Run reconciliation automatically for wagers stuck in `SETTLING`](#53-run-reconciliation-automatically-for-wagers-stuck-in-settling) | P1 | Medium | stellar wagers reliability |
| 54 | [Handle `TRY_AGAIN_LATER` responses from `sendTransaction`](#54-handle-try_again_later-responses-from-sendtransaction) | P2 | Easy | stellar reliability good first issue |
| 55 | [Make the transaction fee policy configurable and support fee bumps](#55-make-the-transaction-fee-policy-configurable-and-support-fee-bumps) | P2 | Medium | stellar reliability |
| 56 | [Contract: extend storage TTLs so pots and config are not archived](#56-contract-extend-storage-ttls-so-pots-and-config-are-not-archived) | P1 | Medium | smart-contract stellar |
| 57 | [Contract: emit events for pot lifecycle changes](#57-contract-emit-events-for-pot-lifecycle-changes) | P2 | Easy | smart-contract stellar observability |
| 58 | [Contract: let players reclaim their stake if the resolver disappears](#58-contract-let-players-reclaim-their-stake-if-the-resolver-disappears) | P1 | Hard | smart-contract stellar security |
| 59 | [Contract: prevent front-running of `initialize`](#59-contract-prevent-front-running-of-initialize) | P1 | Medium | smart-contract security |
| 60 | [Contract: add admin rotation and an upgrade path](#60-contract-add-admin-rotation-and-an-upgrade-path) | P2 | Medium | smart-contract feature |
| 61 | [Contract: optional platform fee (rake) on payouts](#61-contract-optional-platform-fee-rake-on-payouts) | P3 | Medium | smart-contract feature wagers |
| 62 | [Add deploy scripts for the escrow contract](#62-add-deploy-scripts-for-the-escrow-contract) | P2 | Easy | smart-contract devops dx |
| 63 | [CI for the Soroban contract](#63-ci-for-the-soroban-contract) | P2 | Easy | smart-contract devops testing |
| 64 | [Generate TypeScript bindings for the contract instead of hand-building ScVals](#64-generate-typescript-bindings-for-the-contract-instead-of-hand-building-scvals) | P3 | Medium | stellar refactor smart-contract |
| 65 | [Expand contract test coverage](#65-expand-contract-test-coverage) | P2 | Medium | smart-contract testing |
| 66 | [Testnet onboarding: fund accounts and issue LYRIC for new players](#66-testnet-onboarding-fund-accounts-and-issue-lyric-for-new-players) | P2 | Medium | stellar feature dx |
| 67 | [Check trustlines before a wager so payouts cannot fail](#67-check-trustlines-before-a-wager-so-payouts-cannot-fail) | P1 | Medium | stellar wagers |
| 68 | [Verify the on-chain contract config at boot and in health checks](#68-verify-the-on-chain-contract-config-at-boot-and-in-health-checks) | P2 | Easy | stellar reliability |
| 69 | [Add an endpoint for the current stake-signature status of a wager](#69-add-an-endpoint-for-the-current-stake-signature-status-of-a-wager) | P2 | Easy | stellar wagers feature |
| 70 | [Let players abandon or forfeit a wagered match](#70-let-players-abandon-or-forfeit-a-wagered-match) | P2 | Medium | wagers feature gameplay |
| 71 | [Admin tools to grant mock balances in mock mode](#71-admin-tools-to-grant-mock-balances-in-mock-mode) | P3 | Easy | mock-mode admin dx good first issue |
| 72 | [Read the token's decimals from the contract instead of hardcoding 7](#72-read-the-tokens-decimals-from-the-contract-instead-of-hardcoding-7) | P3 | Medium | stellar tokens |
| 73 | [Paginate and shape wager API responses](#73-paginate-and-shape-wager-api-responses) | P2 | Easy | wagers api |
| 74 | [Use `STELLAR_HORIZON_URL` or remove it](#74-use-stellar_horizon_url-or-remove-it) | P3 | Easy | stellar refactor good first issue |
| 75 | [Allow signing up with a wallet](#75-allow-signing-up-with-a-wallet) | P3 | Medium | stellar auth feature |
| 76 | [Unify the genre and category taxonomy](#76-unify-the-genre-and-category-taxonomy) | P1 | Medium | refactor gameplay database |
| 77 | [Normalize how decades are represented](#77-normalize-how-decades-are-represented) | P2 | Easy | refactor lyrics validation |
| 78 | [Award XP and update levels on correct guesses](#78-award-xp-and-update-levels-on-correct-guesses) | P1 | Medium | feature gameplay xp |
| 79 | [Record every guess in `game_history`](#79-record-every-guess-in-game_history) | P1 | Medium | feature gameplay game-history |
| 80 | [Apply the streak bonus and difficulty multipliers](#80-apply-the-streak-bonus-and-difficulty-multipliers) | P2 | Medium | feature gameplay scoring |
| 81 | [Improve answer matching: accents, "feat.", articles and typos](#81-improve-answer-matching-accents-feat-articles-and-typos) | P1 | Medium | feature gameplay bug |
| 82 | [Send notifications from real gameplay events and store them](#82-send-notifications-from-real-gameplay-events-and-store-them) | P2 | Medium | feature notifications |
| 83 | [Run head-to-head matches on the server](#83-run-head-to-head-matches-on-the-server) | P0 | Hard | feature gameplay wagers |
| 84 | [Invitation flow for multiplayer sessions: accept and decline](#84-invitation-flow-for-multiplayer-sessions-accept-and-decline) | P1 | Medium | feature gameplay game-sessions |
| 85 | [Real-time multiplayer over WebSockets](#85-real-time-multiplayer-over-websockets) | P2 | Hard | feature websocket gameplay |
| 86 | [Timed rounds and a speed bonus](#86-timed-rounds-and-a-speed-bonus) | P2 | Medium | feature gameplay |
| 87 | [Daily challenge mode](#87-daily-challenge-mode) | P3 | Medium | feature gameplay |
| 88 | [Hints that cost points](#88-hints-that-cost-points) | P3 | Easy | feature gameplay |
| 89 | [Track lyric usage and calibrate difficulty from real results](#89-track-lyric-usage-and-calibrate-difficulty-from-real-results) | P3 | Medium | feature lyrics data |
| 90 | [Use player preferences when choosing lyrics](#90-use-player-preferences-when-choosing-lyrics) | P3 | Easy | feature gameplay users |
| 91 | [Rooms: host, player limit, start and results](#91-rooms-host-player-limit-start-and-results) | P2 | Medium | feature rooms |
| 92 | [Rooms: list open rooms and join by short code](#92-rooms-list-open-rooms-and-join-by-short-code) | P3 | Easy | feature rooms good first issue |
| 93 | [Persist achievements](#93-persist-achievements) | P3 | Medium | feature gameplay notifications |
| 94 | [Friends and direct challenges](#94-friends-and-direct-challenges) | P3 | Medium | feature social |
| 95 | [Leaderboards: time periods, public access and active users only](#95-leaderboards-time-periods-public-access-and-active-users-only) | P2 | Medium | feature leaderboard |
| 96 | [Avoid repeating lyrics a player has already seen](#96-avoid-repeating-lyrics-a-player-has-already-seen) | P3 | Medium | feature gameplay |
| 97 | [`top-scores` ignores player two and has no pagination](#97-top-scores-ignores-player-two-and-has-no-pagination) | P3 | Easy | bug game-sessions leaderboard |
| 98 | [Bulk import lyrics from CSV or JSON](#98-bulk-import-lyrics-from-csv-or-json) | P2 | Medium | feature lyrics admin |
| 99 | [Expose lyrics search, and fix its cache key](#99-expose-lyrics-search-and-fix-its-cache-key) | P3 | Easy | feature lyrics good first issue |
| 100 | [Paginate lyric and admin list endpoints](#100-paginate-lyric-and-admin-list-endpoints) | P2 | Easy | performance lyrics admin |
| 101 | [Let players report wrong lyrics or answers](#101-let-players-report-wrong-lyrics-or-answers) | P3 | Medium | feature lyrics moderation |
| 102 | [Accept alternative answers (aliases)](#102-accept-alternative-answers-aliases) | P2 | Medium | feature lyrics gameplay |
| 103 | [Admin: view and restore deactivated lyrics](#103-admin-view-and-restore-deactivated-lyrics) | P3 | Easy | feature admin lyrics good first issue |
| 104 | [Limit snippet length and document the content policy](#104-limit-snippet-length-and-document-the-content-policy) | P2 | Easy | lyrics legal validation |
| 105 | [Verify email addresses](#105-verify-email-addresses) | P2 | Medium | feature auth users |
| 106 | [Password reset flow](#106-password-reset-flow) | P2 | Medium | feature auth |
| 107 | [Change password while signed in](#107-change-password-while-signed-in) | P3 | Easy | feature auth good first issue |
| 108 | [Self-service profile updates and a richer profile](#108-self-service-profile-updates-and-a-richer-profile) | P2 | Easy | feature users |
| 109 | [Account deletion and data export](#109-account-deletion-and-data-export) | P2 | Medium | feature users privacy |
| 110 | [Public player profiles](#110-public-player-profiles) | P3 | Easy | feature users social |
| 111 | [Add a Dockerfile and docker-compose for local development](#111-add-a-dockerfile-and-docker-compose-for-local-development) | P2 | Easy | devops dx |
| 112 | [GitHub Actions CI for lint, type-check, tests and build](#112-github-actions-ci-for-lint-type-check-tests-and-build) | P1 | Easy | devops testing |
| 113 | [Proper health and readiness endpoints](#113-proper-health-and-readiness-endpoints) | P2 | Easy | devops reliability |
| 114 | [Structured logging with Winston and request IDs](#114-structured-logging-with-winston-and-request-ids) | P2 | Medium | devops logging |
| 115 | [Use Redis for the cache so multiple instances stay consistent](#115-use-redis-for-the-cache-so-multiple-instances-stay-consistent) | P2 | Medium | devops performance caching |
| 116 | [Make TypeORM query logging configurable](#116-make-typeorm-query-logging-configurable) | P2 | Easy | devops performance database |
| 117 | [Read-replica configuration: port type, and stale reads after writes](#117-read-replica-configuration-port-type-and-stale-reads-after-writes) | P2 | Medium | database bug reliability |
| 118 | [Complete the Swagger and OpenAPI documentation](#118-complete-the-swagger-and-openapi-documentation) | P2 | Easy | docs api |
| 119 | [Run end-to-end tests against a real Postgres database](#119-run-end-to-end-tests-against-a-real-postgres-database) | P1 | Medium | testing |
| 120 | [Remove scaffold leftovers and dead files](#120-remove-scaffold-leftovers-and-dead-files) | P3 | Easy | refactor good first issue |
| 121 | [Tighten TypeScript and ESLint settings](#121-tighten-typescript-and-eslint-settings) | P3 | Medium | refactor dx |
| 122 | [Add a global API prefix and versioning](#122-add-a-global-api-prefix-and-versioning) | P3 | Easy | api refactor |
| 123 | [Graceful shutdown that lets in-flight settlements finish](#123-graceful-shutdown-that-lets-in-flight-settlements-finish) | P2 | Medium | reliability stellar |
| 124 | [Contributor documentation and GitHub templates](#124-contributor-documentation-and-github-templates) | P3 | Easy | docs good first issue |
| 125 | [Prometheus metrics for the API, settlement and the RPC](#125-prometheus-metrics-for-the-api-settlement-and-the-rpc) | P3 | Medium | devops observability stellar |

---

## 1. Critical bugs and boot blockers

### 1. `LyricsController` cannot be constructed because `LyricsService` is imported with `import type`

**Labels:** `bug` `critical` `lyrics` · **Priority:** P0 · **Difficulty:** Easy

**Description**
`src/lyrics/lyrics.controller.ts:12` imports `LyricsService`, `CreateLyricsDto`, `UpdateLyricsDto` and `User` with `import type`. A type-only import is erased at compile time, so with `emitDecoratorMetadata` the compiler writes `design:paramtypes = [Function]` for the controller constructor. Compiling the file confirms it. Nest resolves constructor dependencies from that metadata, so it looks for a provider called `Function`, cannot find one, and fails to instantiate `LyricsController`. The `/lyrics` routes and possibly the whole app never start. The DTO type imports have the same problem: `ValidationPipe` receives `Function` as the metatype and skips validation.

**Tasks**
- [ ] Replace the `import type` statements for `LyricsService`, `CreateLyricsDto`, `UpdateLyricsDto` and `User` with value imports.
- [ ] Add an ESLint rule (`@typescript-eslint/consistent-type-imports` with `fixStyle: 'inline-type-imports'` plus a custom rule or review note) so that DI tokens and DTOs are never imported as types.
- [ ] Add a module-compilation test (`Test.createTestingModule({ imports: [LyricsModule] })` with a mocked repository and cache) that fails when DI cannot resolve.
- [ ] Boot the app locally against a database and confirm `/lyrics` responds.

**Acceptance criteria**
- [ ] `npm run start:dev` boots without a "Nest can't resolve dependencies of the LyricsController" error.
- [ ] The emitted metadata for `LyricsController` lists `LyricsService` rather than `Function`.
- [ ] A regression test covers module compilation.

---

### 2. `POST /lyrics` and `PATCH /lyrics/:id` ignore the request body (missing `@Body()`)

**Labels:** `bug` `critical` `lyrics` `admin` · **Priority:** P0 · **Difficulty:** Easy

**Description**
`LyricsController.create` (`src/lyrics/lyrics.controller.ts:40`) and `LyricsController.update` (`:137`) declare a DTO parameter but do not decorate it with `@Body()`. Nest therefore passes `undefined`, and `LyricsService.create` spreads `undefined` into the entity. Admins cannot create or edit lyrics through the API, and no validation runs on the payload.

**Tasks**
- [ ] Add `@Body()` to both DTO parameters (after fixing the type imports in issue #1).
- [ ] Add `@ApiBody` and response types for Swagger.
- [ ] Write controller tests that post a real payload through `supertest` and assert it reaches the service.
- [ ] Write a negative test that an invalid genre or missing field returns `400`.

**Acceptance criteria**
- [ ] An admin can create a lyric via `POST /lyrics`, and it is persisted with the submitted fields.
- [ ] `PATCH /lyrics/:id` changes only the submitted fields.
- [ ] Invalid payloads are rejected with `400` and a validation message.

---

### 3. `@GetUser('id')` returns the whole `User` object, which breaks every rooms endpoint

**Labels:** `bug` `critical` `rooms` `auth` · **Priority:** P0 · **Difficulty:** Easy

**Description**
`GetUser` (`src/auth/decorators/user.decorator.ts:7`) ignores its `data` argument and always returns `request.user`. `RoomsController` uses `@GetUser('id') userId: string` (`src/rooms/rooms.controller.ts:21` and below), so `userId` is actually a `User` entity. `roomUserRepository.create({ roomId, userId })` then receives an object, and lookups such as `where: { roomId, userId }` never match. Joining a room, reading its status and guessing are all broken.

**Tasks**
- [ ] Change `GetUser` to return `data ? request.user?.[data] : request.user`, and type it with `keyof User`.
- [ ] Audit every `@GetUser(...)` call site to confirm the expected shape.
- [ ] Add unit tests for the decorator factory, with and without a key.
- [ ] Add an e2e test that joins a room and then fetches its status.

**Acceptance criteria**
- [ ] `@GetUser('id')` yields the user's UUID string.
- [ ] Joining, reading status and guessing in a room work end to end.
- [ ] The decorator has test coverage.

---

### 4. A fresh database cannot be built from the migrations

**Labels:** `bug` `critical` `database` `migrations` · **Priority:** P0 · **Difficulty:** Hard

**Description**
Running `npm run migration:run` on an empty database does not produce the schema the entities expect:
- `1691625843781-CreateRoomsAndRoomUsers` has the earliest timestamp, so it runs first and adds foreign keys to `lyrics` and `users`, which do not exist yet.
- `1754625843781-CreateUsersTable` creates `users` without `username`, `xp`, `level`, `levelTitle`, `role`, `isActive` or `lastLoginAt`, and no later migration adds them.
- No migration in `src/migrations` creates `lyrics` or `game_history`. Those tables exist only in the stray root-level `1755089219993-CreateGameHistoryTable.ts` (issue #5), which also recreates `users`, `game_sessions` and `wagers`.
- `uuid_generate_v4()` is used everywhere, but no migration runs `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`.
- Enum type names (`game_category_enum`, `wager_status_enum`) differ from the names TypeORM generates (`game_sessions_category_enum`, …), so `migration:generate` always produces a noisy diff.

**Tasks**
- [ ] Decide on a strategy: squash into one baseline migration for new installs, or repair the existing chain in place. Document the choice.
- [ ] Create a baseline that enables `uuid-ossp` and creates `users`, `lyrics`, `game_sessions`, `game_history`, `rooms`, `room_users` and `wagers` in dependency order, matching the current entities exactly.
- [ ] Give enum types explicit `enumName`s in the entities so migrations and entities agree.
- [ ] Add a CI job that runs all migrations against an empty Postgres and then runs `migration:generate --dryrun` (or `schema:log`) to assert there is no drift.
- [ ] Write an upgrade note for existing databases.

**Acceptance criteria**
- [ ] `createdb x && npm run migration:run` succeeds on an empty Postgres 14+.
- [ ] After migrating, `typeorm schema:log` reports no pending changes.
- [ ] CI fails if an entity change ships without a migration.

---

### 5. Stray migration file at the repository root

**Labels:** `bug` `database` `migrations` `good first issue` · **Priority:** P1 · **Difficulty:** Easy

**Description**
`1755089219993-CreateGameHistoryTable.ts` sits at the repository root. `typeorm.config.ts` only loads `src/migrations/*`, so this file never runs. It is also not only a game-history migration: it recreates `users`, `game_sessions`, `wagers` and `lyrics`, and it defines the level enum with `'Gossip God'` (see issue #6). New contributors will not know whether it is meant to be applied.

**Tasks**
- [ ] Take the parts still needed (the `lyrics` and `game_history` tables and indexes) into the baseline from issue #4.
- [ ] Delete the root-level file.
- [ ] Add a lint or CI check that fails if a `*Migration*`-style file exists outside `src/migrations`.

**Acceptance criteria**
- [ ] No migration files exist outside `src/migrations`.
- [ ] `game_history` and `lyrics` are created by a migration that actually runs.

---

### 6. Level-title enum mismatch: `'Gossip God'` vs `'Gossip Guru'`

**Labels:** `bug` `database` `users` `good first issue` · **Priority:** P1 · **Difficulty:** Easy

**Description**
`UserLevel.GOSSIP_GURU` in `src/users/entities/user.entity.ts` is `'Gossip Guru'`, but the only migration that creates `users_leveltitle_enum` defines `'Gossip God'`. Any user who reaches 1000 XP would fail to save with `invalid input value for enum`.

**Tasks**
- [ ] Pick the canonical title. The README and `XpLevelService` both use "Gossip Guru".
- [ ] Write a migration that renames the enum value (`ALTER TYPE ... RENAME VALUE`).
- [ ] Add a test that saves a user at each level title.

**Acceptance criteria**
- [ ] The enum values in the database match `UserLevel` exactly.
- [ ] A user can be saved with every `UserLevel` value.

---

### 7. `room_users.userId` is created as `integer`, but `users.id` is a UUID

**Labels:** `bug` `database` `rooms` · **Priority:** P0 · **Difficulty:** Easy

**Description**
`CreateRoomsAndRoomUsers1691625843781` declares `room_users.userId` as `integer` with a foreign key to `users.id`, which is `uuid`. Postgres rejects the foreign key, so the migration fails. Even if it were forced, the `RoomUser` entity writes UUID strings into the column.

**Tasks**
- [ ] Fix the column type to `uuid` (in the baseline from issue #4, or in a corrective migration).
- [ ] Add the missing `UNIQUE (userId, roomId)` constraint that the entity declares.
- [ ] Add a migration test for rooms.

**Acceptance criteria**
- [ ] `room_users.userId` is `uuid`, with a working foreign key to `users(id)`.
- [ ] The unique constraint exists and prevents joining the same room twice.

---

### 8. A wager becomes `STAKED` after only one player signs their stake

**Labels:** `bug` `critical` `stellar` `wagers` `security` · **Priority:** P0 · **Difficulty:** Medium

**Description**
In non-custodial mode, `WagerService.createWager` stores each player's *unsigned* stake hash in `playerAStakeTxHash` and `playerBStakeTxHash` (`src/tokens/services/wager.service.ts:179`). `confirmStake` later decides that both players have staked when both hash columns are non-empty (`:287`). Because both were filled at creation, the first successful `POST /game-sessions/:id/stake` flips the wager to `STAKED` while the other player's stake has never been submitted. On-chain the pot stays `Open`, so `resolve` later fails with `PotNotFunded` and the wager ends in `FAILED`.

**Tasks**
- [ ] Split the bookkeeping: keep `playerAStakeUnsignedHash` / `playerBStakeUnsignedHash` (or a JSON column) separate from confirmed stake hashes, plus `playerAStakedAt` / `playerBStakedAt`.
- [ ] Write a migration for the new columns.
- [ ] Only move to `STAKED` when both confirmations have succeeded. Ideally, also read the pot with `EscrowContractService.getPot` and require `status === Funded`.
- [ ] Reject a second confirmation from a player who has already staked.
- [ ] Add unit tests for "A confirms, B has not" and "both confirm".

**Acceptance criteria**
- [ ] After only one confirmation, the wager stays `AWAITING_STAKES` and the response says it is waiting for the opponent.
- [ ] The wager becomes `STAKED` only after both confirmations, and matches the on-chain `Funded` status.
- [ ] Tests cover both paths.

---

### 9. Reconciliation records interrupted payouts as refunds

**Labels:** `bug` `critical` `stellar` `wagers` · **Priority:** P0 · **Difficulty:** Medium

**Description**
`WagerService.settle` sets `winnerId` only inside `applySuccess`, which runs after a *confirmed* result. When a payout is submitted but not yet confirmed, the wager is left in `SETTLING` with `winnerId = null`. `reconcileWager` then decides the final status with `wager.winnerId ? WON : REFUNDED` (`src/tokens/services/wager.service.ts:438`). So every payout that needed reconciliation is recorded as `REFUNDED`, even though the winner received the pot on-chain.

**Tasks**
- [ ] Persist the settlement *intent* (`settlementKind: 'payout' | 'refund'` and `intendedWinnerId`) when entering `SETTLING`, before the network call.
- [ ] In reconciliation, use the on-chain pot status (`Resolved` vs `Refunded`) as the source of truth, and cross-check it against the recorded intent.
- [ ] Set `winnerId` from the intent when reconciliation confirms a payout.
- [ ] Add tests that simulate an unconfirmed payout followed by reconciliation.

**Acceptance criteria**
- [ ] An interrupted payout reconciles to `WON` with the correct `winnerId`.
- [ ] An interrupted refund reconciles to `REFUNDED`.
- [ ] If the intent and the on-chain status disagree, the wager is marked `FAILED` for operator review and an error is logged.

---

### 10. `complete-wagered` marks the session completed even when settlement fails

**Labels:** `bug` `critical` `game-sessions` `wagers` · **Priority:** P0 · **Difficulty:** Medium

**Description**
`GameSessionsService.completeWageredGame` sets `status = COMPLETED` and a winner, calls the wager service, and saves the session whatever the wager result was. If the wager is not `STAKED` (for example, still awaiting signatures), or if the payout fails or is only `SUBMITTED`, the session is still stored as completed. A retry is then refused with "Game session is already completed", so the pot can never be settled through the API.

**Tasks**
- [ ] Check that the wager is `STAKED` before accepting completion, and return `409` otherwise.
- [ ] Only mark the session `COMPLETED` when the wager result is `success` or `SETTLING` (pending reconciliation). Otherwise keep it `IN_PROGRESS` and surface the error.
- [ ] Record the final scores separately from the settlement outcome, so a retry uses the same result.
- [ ] Make the endpoint idempotent: calling it again on a `SETTLING` wager returns the current state.
- [ ] Add tests for each wager outcome.

**Acceptance criteria**
- [ ] A failed settlement leaves the session retryable.
- [ ] A successful settlement completes the session exactly once.
- [ ] The response clearly distinguishes "settled", "settling" and "failed".

---

### 11. Mock settlement pots live in memory and are lost on restart

**Labels:** `bug` `wagers` `mock-mode` · **Priority:** P1 · **Difficulty:** Medium

**Description**
`MockTokenService` keeps pots in a process-local `Map` (`src/tokens/services/mock-token.service.ts:48`), but player balances are debited in Postgres. After a restart or deploy, or when running more than one instance, every `STAKED` wager points at a pot that no longer exists. `releaseToWinner` and `refundEscrow` then return "No pot open for session …", and the staked balances are gone for good.

**Tasks**
- [ ] Persist mock pot state. Either add a `mock_pots` table, or derive it from the `wagers` row (the stake hashes and status already carry most of it).
- [ ] Make pot operations transactional with the balance changes, using the existing row lock pattern.
- [ ] Add a test that rebuilds the service (a new instance) between staking and resolving.

**Acceptance criteria**
- [ ] A wager staked before a restart can be resolved or refunded after it.
- [ ] Two instances of the app share the same pot state.

---

### 12. CORS is enabled after the server starts listening

**Labels:** `bug` `http` `good first issue` · **Priority:** P1 · **Difficulty:** Easy

**Description**
In `src/main.ts`, `app.enableCors(...)` is called after `await app.listen(port)` (`:34`–`:36`). CORS configuration applied after `listen` is not registered on the running HTTP adapter, so browser clients on `FRONTEND_URL` are blocked by CORS. The log line also always prints `localhost`, whatever the host.

**Tasks**
- [ ] Move `enableCors` before `listen`, or pass `cors` in `NestFactory.create`.
- [ ] Support a comma-separated list in `FRONTEND_URL`.
- [ ] Add an e2e test that checks the `Access-Control-Allow-Origin` header for an allowed origin and its absence for a disallowed one.

**Acceptance criteria**
- [ ] A preflight request from `FRONTEND_URL` receives the correct CORS headers.
- [ ] Origins not on the list are rejected.

---

### 13. `GameGateway` is not registered in any module, so the WebSocket API does not exist

**Labels:** `bug` `websocket` `game` · **Priority:** P1 · **Difficulty:** Easy

**Description**
`src/game/game.gateway.ts` defines the `/game` namespace (`requestLyric`, `submitGuess`, `getSession`), and the README documents it. However, `GameModule` lists only `GameLogicService` in `providers`. A gateway that is not a provider is never instantiated, so no Socket.IO server is started. `@nestjs/platform-socket.io` is also missing from `package.json`, and Nest needs it for Socket.IO gateways.

**Tasks**
- [ ] Add `@nestjs/platform-socket.io` as a dependency.
- [ ] Register `GameGateway` in `GameModule.providers`.
- [ ] Add a gateway e2e test using `socket.io-client` that connects, requests a lyric and submits a guess.
- [ ] Coordinate with issue #40 (gateway authentication) before release.

**Acceptance criteria**
- [ ] A client can connect to the `/game` namespace and receive `connected`.
- [ ] `requestLyric` and `submitGuess` work end to end in a test.

---

### 14. Creating lyrics fails because `lyricSnippet` is required but never supplied

**Labels:** `bug` `lyrics` `database` · **Priority:** P0 · **Difficulty:** Easy

**Description**
The `Lyrics` entity has a non-nullable `lyricSnippet` column, and gameplay serves `lyricSnippet`, not `content`. `CreateLyricsDto` has no `lyricSnippet` field, and with `forbidNonWhitelisted` a client cannot send one. `LyricsService.create` does not derive one either, so every insert fails with a not-null violation. The seed script (issue #15) has the same gap.

**Tasks**
- [ ] Add `lyricSnippet` to `CreateLyricsDto`, with length limits (see issue #104).
- [ ] Alternatively, derive a default snippet from `content` when none is given. Document which behaviour applies.
- [ ] Add optional `category` and `difficulty` to the DTO, since the entity supports them.
- [ ] Add service and e2e tests for creation.

**Acceptance criteria**
- [ ] `POST /lyrics` with valid fields persists a row with a non-empty `lyricSnippet`.
- [ ] Missing or oversized snippets are rejected with `400`.

---

### 15. Seed script creates a non-admin "admin", hardcodes a password, and inserts invalid rows

**Labels:** `bug` `seed` `dx` · **Priority:** P1 · **Difficulty:** Easy

**Description**
The seed script (`src/seeds/seed.ts`) has several problems:
- It creates `admin@lyricflip.local` without `role: Role.Admin`, so the "admin" cannot reach any admin route.
- It hashes the literal password `'yourAdminPassword'`.
- It omits `lyricSnippet`, which is `NOT NULL`, so inserts fail.
- Many genres are wrong (The Beatles tagged as Hip-Hop, Green Day as Afrobeats).
- Several "songs" are placeholders ("Hip Hop Sample", "Halo (sample)" credited with lyrics from a different song).
- It boots the whole `AppModule`, including Stellar config, just to seed.

**Tasks**
- [ ] Read `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` from the environment, and refuse to run in production without them.
- [ ] Set `role: Role.Admin` on the seeded admin.
- [ ] Add `lyricSnippet`, correct genres, and use short, clearly attributed snippets (see issue #104).
- [ ] Move the seed data to a JSON fixture, and use a slim `DataSource` rather than the full app.
- [ ] Make the seed idempotent, keyed on `(artist, songTitle)`, which matches the unique constraint.

**Acceptance criteria**
- [ ] `npm run seed` succeeds on a freshly migrated database and can be run twice safely.
- [ ] The seeded admin can call `GET /admin/users`.
- [ ] No hardcoded credentials remain in the repository.

---

### 16. `game-logic` module is dead code with a level-type bug and a clashing class name

**Labels:** `bug` `refactor` `xp` · **Priority:** P2 · **Difficulty:** Easy

**Description**
`src/game-logic/game-logic.service.ts` defines a second class named `GameLogicService`, which clashes with the one in `src/game/game.service.ts`. It is not provided by any module. It also writes a `UserLevel` title string into the numeric `level` column (`user.level = level as unknown as number`, `:21`), which would throw at the database. Meanwhile `XpLevelService` is not provided anywhere either, so no XP is ever awarded (see issue #78).

**Tasks**
- [ ] Delete `src/game-logic` or fold it into an `XpModule`. Update the README table accordingly.
- [ ] Create an `XpModule` that provides and exports `XpLevelService`.
- [ ] Make `XpLevelService` return both a numeric level (1–5) and a `levelTitle`.
- [ ] Add unit tests for the level boundaries (99/100, 299/300, …).

**Acceptance criteria**
- [ ] Only one class named `GameLogicService` exists.
- [ ] Level updates write a number to `level` and an enum value to `levelTitle`.

---

### 17. Genre filters on `/game/*` crash in Postgres (`lower(enum)` does not exist)

**Labels:** `bug` `game` `database` · **Priority:** P1 · **Difficulty:** Easy

**Description**
`GameLogicService.getRandomLyric` and `getLyricStats` filter with `LOWER(lyrics.genre) = LOWER(:genre)` (`src/game/game.service.ts:89`, `:274`). `genre` is a Postgres enum, and `lower()` has no overload for enums, so any request with `?genre=` fails with `function lower(lyrics_genre_enum) does not exist` and a `500`.

**Tasks**
- [ ] Cast the column (`LOWER(lyrics.genre::text)`), or better, validate `genre` against the `Genre` enum in the DTO and compare it directly.
- [ ] Add `@IsEnum(Genre)` to `RandomLyricOptionsDto.genre`.
- [ ] Add an integration test against a real Postgres (see issue #119).

**Acceptance criteria**
- [ ] `GET /game/lyric?genre=Pop` returns a lyric or `404`, never `500`.
- [ ] Invalid genres return `400`.

---

### 18. Gameplay serves and scores soft-deleted lyrics

**Labels:** `bug` `game` `lyrics` · **Priority:** P1 · **Difficulty:** Easy

**Description**
`LyricsService.remove` soft-deletes by setting `isActive = false`. However, `GameLogicService.getRandomLyric`, `getLyricStats`, `checkGuess` and `RoomsService.create` never filter on `isActive`. Lyrics removed by an admin (for example, wrong answers or takedown requests) keep being served to players.

**Tasks**
- [ ] Add `isActive = true` to every gameplay query.
- [ ] Consider a TypeORM global scope or a `DeleteDateColumn` so the filter is on by default.
- [ ] Add tests that a deactivated lyric is never served.

**Acceptance criteria**
- [ ] Deactivated lyrics never appear in `/game/*`, rooms, or the WebSocket gateway.
- [ ] Guessing a deactivated lyric returns `404`.

---

### 19. Expired rooms are never closed

**Labels:** `bug` `rooms` · **Priority:** P2 · **Difficulty:** Easy

**Description**
`RoomsService.checkAndCloseExpiredRooms` queries `expiresAt: new Date()` (`src/rooms/rooms.service.ts:153`), an exact-equality match that almost never hits. It is also never called: there is no scheduler in the app. In addition, `join` and `submitGuess` check `isClosed` but not `expiresAt`, so rooms stay playable forever.

**Tasks**
- [ ] Use `LessThanOrEqual(new Date())`, and close rooms with a single `UPDATE`.
- [ ] Add `@nestjs/schedule` and run the sweep every minute, or check `expiresAt` lazily on each access.
- [ ] Reject join and guess when `expiresAt` has passed.
- [ ] Add tests using fake timers.

**Acceptance criteria**
- [ ] Rooms past `expiresAt` reject joins and guesses with a clear message.
- [ ] The sweeper closes expired rooms.

---

### 20. `CreateRoomDto.lyricId` is validated as a UUID, but lyric IDs are integers

**Labels:** `bug` `rooms` `validation` `good first issue` · **Priority:** P2 · **Difficulty:** Easy

**Description**
`src/rooms/dto/create-room.dto.ts:8` applies `@IsUUID()` to `lyricId`, but `Lyrics.id` is a serial integer. It is impossible to create a room for a specific lyric: any valid ID is rejected with `400`, and any UUID then fails `Number(...)`.

**Tasks**
- [ ] Change the field to `@IsInt() @Min(1) @Type(() => Number) lyricId?: number`.
- [ ] Remove the `Number(...)` coercion in `RoomsService.create`.
- [ ] Add DTO validation tests.

**Acceptance criteria**
- [ ] `POST /rooms/create { "lyricId": 3 }` creates a room for lyric 3.
- [ ] Non-integer IDs are rejected.

---

### 21. Room guesses are scored against the full lyric text, and room status leaks the answers

**Labels:** `bug` `rooms` `gameplay` `security` · **Priority:** P1 · **Difficulty:** Medium

**Description**
`RoomsService.submitGuess` scores a guess with `compareTwoStrings(guess, lyric.content)` (`:136`), the similarity to the *entire lyric body*. The game is about guessing the artist or title, so room scores are meaningless. `getRoomStatus` blanks only `content` (`:110`) and still returns `artist`, `songTitle` and `lyricSnippet`, so the answers are visible before guessing. It also returns `roomUsers.user`, which includes password hashes (see issue #27).

**Tasks**
- [ ] Add `guessType` (`artist` | `songTitle`) to `GuessLyricDto`, and reuse the matching logic from `GameLogicService.checkGuess` (see issue #81).
- [ ] Shape the room status response. Before a user guesses, include only the snippet and public metadata. After guessing, include the answer.
- [ ] Return player summaries (id, username, hasGuessed, score), not full `User` entities.
- [ ] Add tests for scoring and for response shaping.

**Acceptance criteria**
- [ ] Guessing the exact artist or title scores as correct. Unrelated text scores zero.
- [ ] The room status never includes `artist` or `songTitle` for a user who has not guessed.
- [ ] No user fields other than `id` and `username` appear in the response.

---

### 22. Leaderboard is cached for 30 milliseconds, not 30 seconds

**Labels:** `bug` `performance` `users` `good first issue` · **Priority:** P2 · **Difficulty:** Easy

**Description**
`cache-manager` v7 TTLs are in milliseconds (the rest of the codebase uses `300000` for 5 minutes). `UsersService.getLeaderboard` calls `set(cacheKey, result, 30)` with the comment "cache for 30s" (`src/users/users.service.ts:154`), so the cache is effectively disabled.

**Tasks**
- [ ] Move the TTL into `cacheConfig` (`leaderboardTTL: 30_000`).
- [ ] Add a unit test that asserts the TTL argument.
- [ ] Audit every other `cacheManager.set` call for unit errors.

**Acceptance criteria**
- [ ] The leaderboard is cached for 30 seconds.
- [ ] TTL constants have explicit units in their names.

---

### 23. Lyrics cache invalidation is a no-op, so edits are served stale

**Labels:** `bug` `caching` `lyrics` · **Priority:** P1 · **Difficulty:** Medium

**Description**
`LyricsService.clearCache()` only logs "Cache clear requested". Create, update and delete call it and assume invalidation happened, but list, category, random and search caches keep serving deleted or edited lyrics until their TTL expires. `getCacheStats` returns hardcoded zeros. `LyricsModule` also registers its own `CacheModule`, which creates a separate store from the global one, so an admin clearing one does not affect the other.

**Tasks**
- [ ] Remove the module-local `CacheModule.register` and use the global cache.
- [ ] Implement invalidation: track keys by prefix in a set, or use a versioned namespace (`lyrics:v{n}:…`) and bump the version on write.
- [ ] Make `getCacheStats` report real numbers where the store supports it.
- [ ] Add tests: update a lyric, then confirm that `findOne`, category and random reads return the new data.

**Acceptance criteria**
- [ ] After `PATCH` or `DELETE /lyrics/:id`, no endpoint returns the old version.
- [ ] `POST /lyrics/cache/clear` actually empties the lyrics caches.

---

### 24. `GET /lyrics/:id` does not parse or validate the ID

**Labels:** `bug` `lyrics` `validation` `good first issue` · **Priority:** P3 · **Difficulty:** Easy

**Description**
`LyricsController.findOne` (`:125`) declares `@Param('id') id: number` without `ParseIntPipe`, so `id` is actually a string. `GET /lyrics/abc` reaches the service, and the cache key and query receive a non-number. Also, `lyrics/random`, `lyrics/genre/:genre` and similar routes must stay declared before `:id` to avoid shadowing, which is fragile.

**Tasks**
- [ ] Add `ParseIntPipe` to `findOne`.
- [ ] Add e2e tests for `/lyrics/abc` (`400`) and `/lyrics/999999` (`404`).

**Acceptance criteria**
- [ ] Non-numeric IDs return `400`.
- [ ] Numeric IDs are typed as numbers inside the service.

---

### 25. Query parameters (`limit`, `offset`, `count`) are unvalidated strings

**Labels:** `bug` `validation` · **Priority:** P2 · **Difficulty:** Easy

**Description**
Several handlers declare `@Query('limit') limit: number` with no pipe: `GET /game-sessions/top-scores`, `/game-sessions/my-recent` and `/game-sessions/wagers/my-history`. The value arrives as a string, or `NaN`, and is passed to `take` and `.limit()`. `limit=100000` returns an unbounded result set. `/users/leaderboard` uses `Number()` and accepts `NaN`.

**Tasks**
- [ ] Create a shared `PaginationQueryDto` (`limit` 1–100 with a default, `offset` or `page`) using `@Type(() => Number)`.
- [ ] Apply it to every list endpoint.
- [ ] Add tests for invalid and too-large values.

**Acceptance criteria**
- [ ] Every list endpoint enforces a maximum page size.
- [ ] Invalid pagination values return `400`.
### 26. Password login lets deactivated users in and signs the JWT twice

**Labels:** `bug` `auth` `good first issue` · **Priority:** P2 · **Difficulty:** Easy

**Description**
`AuthService.login` never checks `user.isActive`, so a deactivated account still receives a token. `JwtStrategy` rejects that token on the next request, which gives the client a confusing "login succeeded, then 401" sequence. `SEP-10 loginWithWallet` does check `isActive`, so the two flows behave differently. `login` also calls `jwtService.sign(payload)` twice and throws away the first result (`src/auth/auth.service.ts:128`).

**Tasks**
- [ ] Reject inactive users in `login` with the same message the wallet flow uses.
- [ ] Remove the duplicate `sign` call.
- [ ] Extract a shared `issueToken(user)` helper that `AuthService` and `StellarAuthService` both use.
- [ ] Add unit tests.

**Acceptance criteria**
- [ ] A deactivated user gets `401 User is inactive` from `POST /auth/login`.
- [ ] Both login flows produce tokens through the same helper.

---

## 2. Security and authorization

### 27. Password hashes are returned in API responses

**Labels:** `security` `critical` `users` · **Priority:** P0 · **Difficulty:** Medium

**Description**
`User.passwordHash` is marked `@Exclude()`, but `ClassSerializerInterceptor` is not registered, so the decorator does nothing. Full `User` entities, including the bcrypt hash, email, `mockBalance` and `role`, are returned by:
- `GET /users` and `GET /users/:id`
- `GET /admin/users`
- every game-session response with the `player` relation
- every wager (`playerA` and `playerB` are `eager: true`)
- every lyric (`createdBy` is `eager: true`)
- room status (`roomUsers.user`)

**Tasks**
- [ ] Register `ClassSerializerInterceptor` globally, and make sure entities are returned as class instances.
- [ ] Also add `select: false` to `passwordHash`, and load it explicitly only in the auth flows.
- [ ] Introduce response DTOs (`PublicUserDto`, `PlayerSummaryDto`) for embedded users.
- [ ] Remove `eager: true` from `Lyrics.createdBy` and the `Wager` player relations, or project them.
- [ ] Add e2e tests that assert no response body contains `passwordHash`.

**Acceptance criteria**
- [ ] No endpoint returns `passwordHash`.
- [ ] Embedded users expose only `id` and `username`, plus any fields that are deliberately public.
- [ ] A test fails if a hash ever appears in a response.

---

### 28. Any logged-in user can update or delete any other user

**Labels:** `security` `critical` `users` · **Priority:** P0 · **Difficulty:** Easy

**Description**
`UsersController` exposes `PATCH /users/:id` and `DELETE /users/:id` with no ownership or role check. Only the global JWT guard applies, so any authenticated user can hard-delete any account. The delete cascades to game history and to every lyric that user created (issue #44). `GET /users` lists every account to any user. `POST /users` is a dead endpoint that always throws.

**Tasks**
- [ ] Restrict `DELETE /users/:id` and `PATCH /users/:id` to admins, or move them under `/admin`.
- [ ] Add self-service `PATCH /users/me` and `DELETE /users/me` (see issues #108 and #109).
- [ ] Restrict `GET /users` to admins.
- [ ] Remove `POST /users`, or route it to signup.
- [ ] Add authorization tests for user vs admin vs owner.

**Acceptance criteria**
- [ ] A normal user gets `403` when modifying or deleting another user.
- [ ] Only admins can list all users.
- [ ] Tests cover every route.

---

### 29. Game sessions can be read, edited and deleted by anyone

**Labels:** `security` `critical` `game-sessions` · **Priority:** P0 · **Difficulty:** Medium

**Description**
`GET /game-sessions`, `GET/PATCH/DELETE /game-sessions/:id` and `GET /game-sessions/:id/wager` do not check that the caller is a participant. `PATCH` accepts the full `CreateGameSessionDto`, so any user can set `score`, `status`, `mode` or `hasWager` on any session, including another player's wagered match.

**Tasks**
- [ ] Add a `SessionParticipantGuard` (or service-level check) that allows player one, player two and admins.
- [ ] Restrict `GET /game-sessions` to the caller's own sessions, or to admins.
- [ ] Replace the `PATCH` DTO with a narrow one. Clients should not set `score`, `status`, `winner` or wager fields directly.
- [ ] Forbid deleting a session with a wager that is not in a terminal state.
- [ ] Add authorization tests.

**Acceptance criteria**
- [ ] Non-participants get `403` or `404` for another user's session and wager.
- [ ] Scores and status can only change through gameplay endpoints.

---

### 30. Any user can decide the winner of a wagered match by posting scores

**Labels:** `security` `critical` `wagers` `stellar` · **Priority:** P0 · **Difficulty:** Hard

**Description**
`PUT /game-sessions/:id/complete-wagered` takes `{ playerOneScore, playerTwoScore }` from the request body and pays the pot to whoever has the higher number. Any authenticated user can call it, participant or not, with any scores. The body is an inline TypeScript type, not a class, so `ValidationPipe` does not validate it at all. This lets anyone steal escrowed funds by choosing the winner.

**Tasks**
- [ ] Short term: restrict the endpoint to admins or an internal service, and add a validated `CompleteWageredGameDto` (non-negative integers).
- [ ] Long term: compute scores on the server from recorded guesses (see issue #83), and complete the match automatically when the rounds end.
- [ ] Audit-log every settlement decision: who triggered it, the inputs, and the resulting transaction hash.
- [ ] Add tests: a non-participant or non-admin gets `403`, and malformed bodies get `400`.

**Acceptance criteria**
- [ ] No player can decide the outcome by submitting numbers.
- [ ] Settlement is triggered only by server-side game completion or by an admin action, and is audit-logged.

---

### 31. Player two is enrolled in a wager, and debited, without consenting

**Labels:** `security` `critical` `wagers` · **Priority:** P0 · **Difficulty:** Hard

**Description**
`POST /game-sessions` with `mode: wagered` and a `playerTwoId` immediately calls `createWager`. In mock mode and in custodial Stellar mode, this stakes **both** players straight away (`stakeTokens` for `playerBId`), debiting player two's balance without their knowledge. Anyone can drain another user's balance into pots.

**Tasks**
- [ ] Introduce an invitation step: the session starts as `WAITING_FOR_PLAYER`, and player two must `POST /game-sessions/:id/accept` (issue #84).
- [ ] Only open the pot and stake player one on creation. Stake player two on acceptance.
- [ ] Add decline and expiry that refund player one.
- [ ] Add tests showing that no funds move for player two before acceptance.

**Acceptance criteria**
- [ ] Player two's balance never changes until they explicitly accept.
- [ ] Declined or expired invitations refund player one in full.

---

### 32. `confirmStake` submits whatever signed XDR the client sends

**Labels:** `security` `stellar` `wagers` · **Priority:** P1 · **Difficulty:** Medium

**Description**
`EscrowContractService.submitSignedStake` (`src/stellar/services/escrow-contract.service.ts:123`) parses the client's XDR and submits it without checking what it is. The backend then records its hash as that player's stake and may advance the wager. A client can post any valid signed transaction, such as a no-op, a payment, or someone else's stake, and have it counted as their stake.

**Tasks**
- [ ] Compare the signed transaction's hash with the unsigned stake hash issued for *this* player and session. Signing does not change the hash.
- [ ] Alternatively, decode the envelope and check that it contains one `invokeHostFunction` operation calling `stake(session_id, player_address)` on the configured escrow contract.
- [ ] Reject anything else with `400` before submitting.
- [ ] Add tests with a mismatched hash, the wrong contract, the wrong player and the wrong function.

**Acceptance criteria**
- [ ] Only the exact stake transaction issued to the caller is accepted.
- [ ] Rejected envelopes never reach the network.

---

### 33. Game history of any user is readable by any user

**Labels:** `security` `game-history` `privacy` · **Priority:** P1 · **Difficulty:** Easy

**Description**
`GET /game-history/users/:userId` is described as "admin functionality" but has no role check. `GET /game-history/:id` returns any record, with `player` (including the password hash, see issue #27), the lyric and the session.

**Tasks**
- [ ] Add `@Roles(Role.Admin)` to `users/:userId`.
- [ ] In `findOne`, check that the record belongs to the caller, or that the caller is an admin.
- [ ] Remove the `player` relation from the response, or project it.
- [ ] Add authorization tests.

**Acceptance criteria**
- [ ] Non-admins can read only their own history.
- [ ] No embedded user entity is returned.

---

### 34. Notification endpoints are open to every user

**Labels:** `security` `notifications` · **Priority:** P1 · **Difficulty:** Easy

**Description**
Any authenticated user can:
- read every user's notifications (`GET /notifications`, `GET /notifications/user/:userId`)
- wipe the global store (`DELETE /notifications`)
- emit arbitrary notifications to any user ID (`POST /notifications/mock-*`, `/test/*`, `/generate-mock-data`)

**Tasks**
- [ ] Replace `GET /notifications` with `GET /notifications/me`.
- [ ] Restrict `user/:userId`, `DELETE` and all mock and test endpoints to admins.
- [ ] Only register the mock and test endpoints when `NODE_ENV !== 'production'`.
- [ ] Add authorization tests.

**Acceptance criteria**
- [ ] A user can read only their own notifications.
- [ ] Mock endpoints do not exist in production builds.

---

### 35. Players can read the answers from `/lyrics` endpoints

**Labels:** `security` `gameplay` `lyrics` · **Priority:** P1 · **Difficulty:** Medium

**Description**
`/game/lyric` deliberately hides `artist` and `songTitle`. But `GET /lyrics/:id`, `/lyrics`, `/lyrics/random` and `/lyrics/genre|decade|artist/*` return full entities to any authenticated player. A client can take the `id` from `/game/lyric`, call `/lyrics/:id` to get the answer, and score 100% every time. `GET /lyrics/artist/:artist` also doubles as an answer search.

**Tasks**
- [ ] Decide which lyric reads are player-facing. Restrict full reads to admins, or remove answer fields for non-admins.
- [ ] Introduce `PlayerLyricDto` (id, snippet, genre, decade, category) and `AdminLyricDto`.
- [ ] Remove or protect `GET /lyrics/artist/:artist`.
- [ ] Add tests that a player cannot obtain `artist` or `songTitle` for a lyric before guessing it.

**Acceptance criteria**
- [ ] No non-admin endpoint reveals the answer to a lyric the caller has not already guessed.

---

### 36. Guesses are not tied to a served round, so answers can be replayed and farmed

**Labels:** `security` `gameplay` · **Priority:** P1 · **Difficulty:** Hard

**Description**
`POST /game/guess` accepts any `lyricId`, and returns `correctAnswer` even when the guess is wrong. A player can guess once to learn the answer, then submit it again for full points. Nothing limits guesses per lyric, and a lyric does not have to have been served to that player. Once XP and history are wired in (issues #78 and #79), this becomes an unlimited XP farm.

**Tasks**
- [ ] Introduce server-issued rounds: `GET /game/lyric` creates a `round` (id, userId, lyricId, issuedAt, expiresAt) and returns its ID.
- [ ] Have `POST /game/guess` take `roundId`, allow one guess per round (or a configured number), and close the round.
- [ ] Only reveal `correctAnswer` after the round closes.
- [ ] Add tests for replay and for guessing an unserved lyric.

**Acceptance criteria**
- [ ] A lyric cannot be scored twice in the same round.
- [ ] Guessing a lyric that was not served to the caller is rejected.

---

### 37. WebSocket gateway accepts every origin and has no authentication

**Labels:** `security` `websocket` · **Priority:** P1 · **Difficulty:** Medium

**Description**
`GameGateway` is configured with `cors: { origin: '*' }` (`src/game/game.gateway.ts:25`) and identifies players by `client.id`. No JWT is checked, so anonymous clients can play, and nothing links socket play to a user account for XP or history. The session map is in memory and grows with connections.

**Tasks**
- [ ] Authenticate the handshake: read the JWT from `auth.token` or the `Authorization` header, verify it, and attach the user to `client.data`.
- [ ] Reuse the `FRONTEND_URL` CORS allow-list.
- [ ] Apply `ValidationPipe` to message bodies (`@UsePipes`).
- [ ] Key sessions by user ID, and clean them up on disconnect.
- [ ] Add tests for unauthenticated connections, which must be rejected.

**Acceptance criteria**
- [ ] Connections without a valid JWT are refused.
- [ ] Socket gameplay is attributed to the authenticated user.

---

### 38. No rate limiting on authentication, guessing or SEP-10

**Labels:** `security` `http` · **Priority:** P1 · **Difficulty:** Easy

**Description**
There is no throttling anywhere. `POST /auth/login` can be brute-forced. `POST /auth/stellar/challenge` builds and signs a transaction per call, so it can be used to exhaust CPU. `POST /game/guess` can be spammed.

**Tasks**
- [ ] Add `@nestjs/throttler` with a global default.
- [ ] Set stricter per-route limits for `auth/login`, `auth/signup`, `auth/stellar/*` and `game/guess`.
- [ ] Key limits by IP and, where available, by user ID.
- [ ] Document how to configure `trust proxy` behind a load balancer.
- [ ] Add tests that confirm `429` after the limit is reached.

**Acceptance criteria**
- [ ] Repeated login attempts are throttled.
- [ ] Limits are configurable through the environment.

---

### 39. Add standard security headers (Helmet)

**Labels:** `security` `http` `good first issue` · **Priority:** P2 · **Difficulty:** Easy

**Description**
The app sets no security headers: no HSTS, no `X-Content-Type-Options`, no frame protection. Swagger UI needs a CSP exception.

**Tasks**
- [ ] Add `helmet` in `main.ts`, with a CSP that still lets `/api/docs` load.
- [ ] Disable `x-powered-by`.
- [ ] Add an e2e test that asserts the key headers.

**Acceptance criteria**
- [ ] Responses include Helmet's default security headers.
- [ ] Swagger UI still renders.

---

### 40. SEP-10 challenges can be replayed, and production silently uses an ephemeral key

**Labels:** `security` `stellar` `auth` · **Priority:** P1 · **Difficulty:** Medium

**Description**
`StellarAuthService.verifyChallenge` checks the signature and the time bounds, but does not record used challenges. A signed challenge can be replayed as many times as needed during its 300-second window, including against `/auth/stellar/link`. If neither `STELLAR_WEB_AUTH_SECRET` nor `STELLAR_RESOLVER_SECRET` is set, the service generates a random key (`:62`) even in production, which breaks multi-instance deployments: each instance signs with a different key.

**Tasks**
- [ ] Store the challenge nonce (from the `manage_data` value) with a TTL in the cache or database, and reject reuse.
- [ ] Throw at boot when `NODE_ENV=production` and no web-auth secret is set.
- [ ] Validate that `STELLAR_WEB_AUTH_SECRET` is a valid `S...` seed.
- [ ] Add tests for replay and for the production boot check.

**Acceptance criteria**
- [ ] A signed challenge can be exchanged only once.
- [ ] A production boot without a web-auth key fails with a clear error.

---

### 41. Add refresh tokens, logout and token revocation

**Labels:** `security` `auth` `feature` · **Priority:** P2 · **Difficulty:** Medium

**Description**
Access tokens last 7 days (`JWT_EXPIRES_IN=7d`), and there is no refresh flow, no logout and no way to revoke tokens after a password change or account deactivation. `JwtStrategy` does check `isActive` on each request, which helps, but stolen tokens stay valid for a week.

**Tasks**
- [ ] Shorten access-token lifetime to about 15 minutes, and issue a rotating refresh token (hashed in a `refresh_tokens` table).
- [ ] Add `POST /auth/refresh` and `POST /auth/logout`.
- [ ] Add a `tokenVersion` column on `User`, and bump it on password change to invalidate existing tokens.
- [ ] Update the README and Swagger.

**Acceptance criteria**
- [ ] Clients can refresh without re-entering credentials.
- [ ] Logout and password change invalidate outstanding refresh tokens.

---

### 42. Log redaction is shallow and misses nested secrets and signed XDR

**Labels:** `security` `logging` · **Priority:** P2 · **Difficulty:** Easy

**Description**
`sanitizeBody` in both interceptors (`error.interceptor.ts:191`, `logging.interceptor.ts:77`) redacts only top-level keys that exactly match `password`, `token`, `secret`, `key` or `authorization`. Nested objects, arrays, and keys such as `transaction` (signed XDR), `accessToken` or `newPassword` are logged in full. `LoggingInterceptor` also logs full bodies at `log` level on every request, and `JSON.stringify`s every response just to measure its size.

**Tasks**
- [ ] Write one shared `redact()` utility that walks the object recursively and matches keys case-insensitively by pattern (`/pass|token|secret|key|authorization|transaction|seed/i`).
- [ ] Use it in both interceptors.
- [ ] Only log request bodies at `debug` level.
- [ ] Drop the `JSON.stringify` response-size calculation, or use the `Content-Length` header instead.
- [ ] Add unit tests with nested payloads.

**Acceptance criteria**
- [ ] No secret, token or signed transaction appears in logs at any level.
- [ ] Redaction is implemented once and tested.

---

### 43. Enforce password strength and normalize emails and usernames

**Labels:** `security` `auth` `validation` `good first issue` · **Priority:** P2 · **Difficulty:** Easy

**Description**
`SignupDto` accepts any 6-character password, and treats `Alice@Example.com` and `alice@example.com` as different accounts. Usernames accept any characters, including spaces, lookalike characters and emoji.

**Tasks**
- [ ] Lowercase and trim emails in signup and login.
- [ ] Require at least 8 characters for passwords, with a basic strength rule or `zxcvbn`.
- [ ] Restrict usernames to `^[a-zA-Z0-9_]{3,20}$`, and enforce case-insensitive uniqueness (a `citext` column or a lower-case index).
- [ ] Write a migration that adds the case-insensitive unique indexes.
- [ ] Add DTO tests.

**Acceptance criteria**
- [ ] Duplicate accounts that differ only by case cannot be created.
- [ ] Weak passwords are rejected with a helpful message.

---

### 44. Deleting a user destroys the lyric catalogue and financial history

**Labels:** `security` `data-integrity` `admin` · **Priority:** P1 · **Difficulty:** Medium

**Description**
`Lyrics.createdBy` has `onDelete: 'CASCADE'` (`src/lyrics/entities/lyrics.entity.ts:58`). Hard-deleting the admin who seeded the catalogue (through `DELETE /admin/users/:id` or the unprotected `DELETE /users/:id`) deletes every lyric they created. That in turn cascades to `game_history` and `rooms`. Deleting a user who has wagers fails on foreign keys, or leaves orphaned wagers.

**Tasks**
- [ ] Change `Lyrics.createdBy` to `ON DELETE SET NULL`, make it nullable, and write the migration.
- [ ] Replace hard deletes with soft deletes (`isActive = false` plus anonymization).
- [ ] Block deleting users with wagers that are not in a terminal state.
- [ ] Add tests.

**Acceptance criteria**
- [ ] Deleting or deactivating a user never deletes lyrics or wager records.
- [ ] Deleted users are anonymized, and their history stays consistent.

---

### 45. Add a KMS or Vault implementation of `IKeyStore`

**Labels:** `security` `stellar` `feature` · **Priority:** P2 · **Difficulty:** Hard

**Description**
`IKeyStore` exists so that keys can move out of environment variables, but only `EnvKeyStore` and `NonCustodialKeyStore` are implemented. The resolver secret, which can settle every pot, and the custodial master seed both sit in environment variables.

**Tasks**
- [ ] Implement `KmsKeyStore` for one provider (for example, AWS KMS with an ed25519 key, or HashiCorp Vault Transit) that signs transaction hashes remotely.
- [ ] Refactor the signing call sites (`signAndSubmit`) to use a `sign(hash)` abstraction instead of raw `Keypair`s.
- [ ] Select the key store with `STELLAR_KEY_STORE=env|kms|vault`.
- [ ] Document setup and key rotation, together with the contract's `set_resolver`.

**Acceptance criteria**
- [ ] With `STELLAR_KEY_STORE=kms`, no Stellar secret appears in the process environment.
- [ ] Settlement works end to end on testnet with the KMS key store.

---

### 46. Validate the full environment at boot and clean up `.env.example`

**Labels:** `security` `config` `dx` · **Priority:** P2 · **Difficulty:** Easy

**Description**
Only the database variables and the Stellar variables are validated. `JWT_SECRET` is checked for presence but not strength. `.env.example` defines `PORT` twice (4000 and 3000), includes a `DATABASE_URL` that nothing reads, and contains plausible-looking credentials (`portable`/`dorcas`).

**Tasks**
- [ ] Add a `validationSchema` (Joi or class-validator) to `ConfigModule.forRoot` covering every variable, with types and defaults.
- [ ] Require `JWT_SECRET` to be at least 32 characters in production.
- [ ] Remove the duplicate `PORT` and the unused `DATABASE_URL` (or support `DATABASE_URL`).
- [ ] Replace sample credentials with obvious placeholders.
- [ ] Document every variable in the README.

**Acceptance criteria**
- [ ] Booting with a missing or invalid variable fails with a message that names it.
- [ ] `.env.example` contains no duplicate keys and no realistic secrets.

---

### 47. Replace `ErrorInterceptor` with a global exception filter

**Labels:** `refactor` `security` `http` · **Priority:** P2 · **Difficulty:** Medium

**Description**
Errors are shaped by an interceptor that rethrows them as a new `HttpException`. Interceptors do not see errors thrown by guards or pipes, so auth and validation errors take a different response shape. Wrapping an `HttpException` inside another one also loses the original `cause`. In development the database error message is returned verbatim, including table and constraint names. The interceptor is also constructed with `new` in `main.ts`, which bypasses dependency injection.

**Tasks**
- [ ] Implement an `AllExceptionsFilter` (`@Catch()`) registered with `APP_FILTER`, producing the existing `ErrorResponse` shape.
- [ ] Map TypeORM `QueryFailedError` codes in the filter.
- [ ] Generate or propagate `x-request-id` (see issue #114).
- [ ] Remove `ErrorInterceptor` and the commented-out `CommonModule`.
- [ ] Update the tests.

**Acceptance criteria**
- [ ] Guard, pipe and handler errors all share one response shape.
- [ ] No raw database error text is returned when `NODE_ENV=production`.

---

### 48. Add audit logging for admin and settlement actions

**Labels:** `security` `admin` `wagers` · **Priority:** P2 · **Difficulty:** Medium

**Description**
Deleting users or lyrics, reconciling wagers, clearing caches and settling pots leave no durable record of who did what. For an app that moves tokens, an audit trail is essential for resolving disputes.

**Tasks**
- [ ] Create an `audit_log` table (actor, action, target type and ID, payload JSON, IP, timestamp).
- [ ] Add an `AuditService`, and an `@Audited('action')` decorator or interceptor.
- [ ] Apply it to admin endpoints, `complete-wagered`, `wager/reconcile` and wallet link/unlink.
- [ ] Add an admin read endpoint with filters.

**Acceptance criteria**
- [ ] Every admin and settlement action creates an audit row.
- [ ] Audit rows cannot be modified through the API.

---

### 49. Block wallet unlinking while the user has an active wager

**Labels:** `security` `stellar` `wagers` · **Priority:** P2 · **Difficulty:** Easy

**Description**
`DELETE /auth/stellar/wallet` clears `stellarAddress` with no checks (`stellar-auth.service.ts:216`). If a player unlinks during a `STAKED` wager, `releaseToWinner` fails in `requireAddress` and the payout cannot be sent. The pot stays locked until an operator steps in. Re-linking a *different* address in the middle of a match changes where the payout goes. The contract prevents this by paying the on-chain `player_a`/`player_b` addresses, but the backend then errors out.

**Tasks**
- [ ] Reject unlinking or relinking when the user has a wager in `pending`, `awaiting_stakes`, `staked` or `settling`.
- [ ] In `releaseToWinner`, pay the address stored on the pot (`getPot`) rather than the one currently linked.
- [ ] Add tests.

**Acceptance criteria**
- [ ] Unlinking during an active wager returns `409` with an explanation.
- [ ] Payouts always go to the address that staked.

---

### 50. Sanitize user-controlled strings before they appear in messages and logs

**Labels:** `security` `good first issue` · **Priority:** P3 · **Difficulty:** Easy

**Description**
Usernames, lyric fields and guesses are interpolated directly into log lines and into user-facing messages, such as the `wins!` message in `completeWageredGame` and the guess explanations. With unrestricted usernames (issue #43), this allows log injection (newlines) and confusing or spoofed messages in clients that render them.

**Tasks**
- [ ] Strip control characters from values before logging them.
- [ ] Return structured fields (`winnerId`, `winnerUsername`) alongside human-readable messages, so clients do not have to parse text.
- [ ] Add unit tests with newline and control-character input.

**Acceptance criteria**
- [ ] Log lines cannot be split by user input.
- [ ] API responses expose structured data next to message strings.
## 3. Stellar, wagers and the escrow contract

### 51. Players cannot get a fresh stake transaction after the first one expires

**Labels:** `stellar` `wagers` `feature` · **Priority:** P1 · **Difficulty:** Medium

**Description**
The unsigned stake transaction built in `createWager` has a 180-second timeout (`TRANSACTION_TIMEOUT_SECONDS`) and uses the player's sequence number from when it was built. If the player takes longer than 3 minutes to sign, or sends any other transaction from that account in the meantime, the XDR becomes invalid. `pendingSignatures` is only returned once, from `POST /game-sessions`, and there is no endpoint to get a new transaction. The wager then stays in `AWAITING_STAKES` for good.

**Tasks**
- [ ] Add `POST /game-sessions/:id/stake/transaction`, which rebuilds the caller's stake transaction if they have not staked yet.
- [ ] Store the latest unsigned hash for each player (together with issue #8).
- [ ] Make the timeout configurable (`STELLAR_STAKE_TX_TIMEOUT_SECONDS`).
- [ ] Add tests.

**Acceptance criteria**
- [ ] A player whose transaction expired can request a new one and complete staking.
- [ ] Only the new transaction's hash is accepted by `confirmStake` (see issue #32).

---

### 52. Refund wagers automatically when a player never stakes

**Labels:** `stellar` `wagers` `feature` · **Priority:** P1 · **Difficulty:** Medium

**Description**
If one player stakes and the other never signs, the pot stays `Open` on-chain with one stake locked in it, and the wager stays in `AWAITING_STAKES`. No job cleans this up. The only way out is an operator calling refund code directly, and even `resolveWagerAsDraw` is only reachable through `complete-wagered`.

**Tasks**
- [ ] Add `stakeDeadline` to `Wager` (configurable, for example 15 minutes), with a migration.
- [ ] Add a scheduled job (`@nestjs/schedule`) that refunds expired `AWAITING_STAKES` wagers through `refundEscrow`, and marks the session `ABANDONED`.
- [ ] Notify both players (see issue #82).
- [ ] Add tests with fake timers.

**Acceptance criteria**
- [ ] Wagers not fully staked by the deadline are refunded automatically.
- [ ] The job is idempotent, so running it twice refunds nothing twice.

---

### 53. Run reconciliation automatically for wagers stuck in `SETTLING`

**Labels:** `stellar` `wagers` `reliability` · **Priority:** P1 · **Difficulty:** Medium

**Description**
`WagerService.reconcileWager` exists, but only an admin can trigger it, one session at a time, through `POST /game-sessions/:id/wager/reconcile`. The code comments say it should run "from a scheduled sweep over wagers that have been settling for too long", but no such sweep exists.

**Tasks**
- [ ] Add a scheduled job that selects wagers with `status = settling` and `updatedAt < now() - interval`, and reconciles each one.
- [ ] Use a Postgres advisory lock so only one instance runs the sweep at a time.
- [ ] Add exponential backoff, and move a wager to `FAILED` with an alert after N attempts.
- [ ] Expose metrics (see issue #125).
- [ ] Add tests.

**Acceptance criteria**
- [ ] Wagers stuck in `SETTLING` are resolved without human action when the chain has a definite answer.
- [ ] Only one instance reconciles at a time.

---

### 54. Handle `TRY_AGAIN_LATER` responses from `sendTransaction`

**Labels:** `stellar` `reliability` `good first issue` · **Priority:** P2 · **Difficulty:** Easy

**Description**
`StellarRpcService.submit` handles the `ERROR` and `DUPLICATE` statuses. It treats `TRY_AGAIN_LATER`, which Soroban RPC returns when the queue is full, like `PENDING`, and then polls for a transaction that was never accepted. After 15 attempts the wager is left in `SETTLING` for reconciliation, when the correct action is to resubmit.

**Tasks**
- [ ] Retry `TRY_AGAIN_LATER` with backoff, up to a configurable number of attempts, before polling.
- [ ] Make the poll attempts and sleep strategy configurable.
- [ ] Add unit tests with a mocked `rpc.Server`.

**Acceptance criteria**
- [ ] A transaction rejected with `TRY_AGAIN_LATER` is resubmitted, and succeeds once the queue clears.

---

### 55. Make the transaction fee policy configurable and support fee bumps

**Labels:** `stellar` `reliability` · **Priority:** P2 · **Difficulty:** Medium

**Description**
Every invocation uses a hardcoded `DEFAULT_MAX_FEE = '1000000'` (0.1 XLM) as the inclusion fee, before `prepareTransaction` adds the resource fee. During surge pricing, resolver transactions can be priced out. In quiet periods, 0.1 XLM per call is more than needed.

**Tasks**
- [ ] Read the base fee from `getFeeStats`, with a configurable ceiling (`STELLAR_MAX_FEE`).
- [ ] Support a fee-bump transaction for resolver transactions stuck in the queue.
- [ ] Log the fee charged on each settlement.
- [ ] Document the fee settings.

**Acceptance criteria**
- [ ] The fee cap is configurable through the environment.
- [ ] Stuck resolver transactions can be fee-bumped.

---

### 56. Contract: extend storage TTLs so pots and config are not archived

**Labels:** `smart-contract` `stellar` · **Priority:** P1 · **Difficulty:** Medium

**Description**
`lyricsflip-escrow` writes pots to `persistent()` storage and the config to `instance()` storage, but never calls `extend_ttl`. Soroban archives entries whose TTL runs out. An archived pot, or the instance itself, must be restored before `resolve` or `refund` will work, and reconciliation reads of `get_pot` fail in the meantime.

**Tasks**
- [ ] Call `env.storage().persistent().extend_ttl(&key, threshold, extend_to)` on every pot write and read.
- [ ] Call `env.storage().instance().extend_ttl(...)` in each entry point.
- [ ] Define the TTL constants based on the expected maximum match length plus a margin.
- [ ] Add tests using `env.ledger().set_sequence_number` to confirm entries survive.

**Acceptance criteria**
- [ ] Pots remain accessible for at least the configured window after their last touch.
- [ ] Tests cover TTL extension.

---

### 57. Contract: emit events for pot lifecycle changes

**Labels:** `smart-contract` `stellar` `observability` · **Priority:** P2 · **Difficulty:** Easy

**Description**
The contract emits no events. Indexers, explorers and the backend cannot follow pot activity (opened, staked, resolved, refunded, resolver rotated) without polling `get_pot`. Events would also let the backend replace polling with event-driven reconciliation.

**Tasks**
- [ ] Publish events with `env.events().publish((symbol_short!("open"), session_id), (player_a, player_b, stake))`, and similar for `stake`, `resolve`, `refund` and `set_resolver`.
- [ ] Add tests that assert on `env.events().all()`.
- [ ] Document the event schema in the README.

**Acceptance criteria**
- [ ] Every state-changing function emits one documented event.

---

### 58. Contract: let players reclaim their stake if the resolver disappears

**Labels:** `smart-contract` `stellar` `security` · **Priority:** P1 · **Difficulty:** Hard

**Description**
Only the resolver can call `refund`. If the resolver key is lost, or the backend is shut down, staked funds are locked in the contract forever. Rotating the resolver requires the admin, which may also be unavailable. Players have no self-service way out.

**Tasks**
- [ ] Add `deadline_ledger` to `Pot`, set by `open_pot` (for example, open ledger plus N).
- [ ] Add `claim_refund(session_id, player)`, authorized by the player, which returns their stake once the deadline has passed and the pot is not `Resolved`.
- [ ] Keep `resolve` restricted to before the deadline, or allow it until a claim is made. Document the chosen rule.
- [ ] Add tests for claims before and after the deadline, and a double claim.
- [ ] Update the backend client and the README.

**Acceptance criteria**
- [ ] After the deadline, each player can recover their own stake without the resolver.
- [ ] No player can claim another player's stake, or claim twice.

---

### 59. Contract: prevent front-running of `initialize`

**Labels:** `smart-contract` `security` · **Priority:** P1 · **Difficulty:** Medium

**Description**
`initialize(admin, token, resolver)` can be called once by *anyone*. It checks `admin.require_auth()`, but the admin is whoever the caller passes in. Between `stellar contract deploy` and `initialize`, an attacker can initialize the contract with their own admin, token and resolver, and the deployer might not notice before players stake.

**Tasks**
- [ ] Move initialization into a constructor (`__constructor`, supported from soroban-sdk 22 / protocol 22) so deployment and initialization are atomic.
- [ ] Alternatively, fix the deployer address at build time and require its authorization.
- [ ] Update the deploy instructions (see issue #62) and the tests.
- [ ] Add a post-deploy check that `get_config` matches the expected values (see issue #68).

**Acceptance criteria**
- [ ] It is impossible to initialize a deployed contract with different parameters.

---

### 60. Contract: add admin rotation and an upgrade path

**Labels:** `smart-contract` `feature` · **Priority:** P2 · **Difficulty:** Medium

**Description**
The admin can rotate the resolver, but there is no way to rotate the admin itself, and no way to upgrade the contract WASM. Fixing a bug, including issues #56 to #59, requires a redeploy with a new contract ID, and every in-flight pot is stranded on the old one.

**Tasks**
- [ ] Add `set_admin(new_admin)`, authorized by the current admin. Consider a two-step propose/accept.
- [ ] Add `upgrade(new_wasm_hash)`, authorized by the admin, using `env.deployer().update_current_contract_wasm`.
- [ ] Add a storage version key and a migration hook.
- [ ] Add tests, and document the upgrade procedure.

**Acceptance criteria**
- [ ] The admin can be rotated safely.
- [ ] The contract can be upgraded in place, and existing pots stay readable.

---

### 61. Contract: optional platform fee (rake) on payouts

**Labels:** `smart-contract` `feature` `wagers` · **Priority:** P3 · **Difficulty:** Medium

**Description**
`resolve` pays `stake * 2` to the winner. There is no way to take a platform fee to fund operations or prize pools. Adding one later is a breaking contract change, so it is worth designing now.

**Tasks**
- [ ] Add `fee_bps` and `fee_recipient` to `Config`, settable by the admin with a hard maximum (for example, 10%).
- [ ] Split the payout in `resolve`. Refunds stay fee-free.
- [ ] Mirror the rule in `MockTokenService` and in the displayed pot amounts.
- [ ] Add tests for rounding (floor the fee) and zero-fee configurations.

**Acceptance criteria**
- [ ] Winner payout plus fee equals the pot exactly.
- [ ] The fee cannot exceed the hard cap.

---

### 62. Add deploy scripts for the escrow contract

**Labels:** `smart-contract` `devops` `dx` · **Priority:** P2 · **Difficulty:** Easy

**Description**
The README explains that "there is no deploy script in the repo" and lists manual `stellar` CLI steps. Deploying is error-prone: the wrong network, a mismatched token, or forgetting to copy the IDs into `.env`.

**Tasks**
- [ ] Add `contracts/scripts/deploy.sh` (or a `Makefile`) that builds, deploys and initializes, taking the network, admin, token and resolver as parameters.
- [ ] Have it print, or write to a file, the `STELLAR_*` values for `.env`.
- [ ] Add an optional step that deploys a test LYRIC token (SAC) on testnet and mints to demo accounts.
- [ ] Document it in the README.

**Acceptance criteria**
- [ ] One command deploys a working escrow to testnet and prints the environment values the backend needs.

---

### 63. CI for the Soroban contract

**Labels:** `smart-contract` `devops` `testing` · **Priority:** P2 · **Difficulty:** Easy

**Description**
No CI runs `cargo test`, `clippy` or the WASM build. Contract changes can break the build or the tests unnoticed.

**Tasks**
- [ ] Add a GitHub Actions job that runs `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` and `cargo build --target wasm32-unknown-unknown --release`.
- [ ] Cache the cargo registry and target directory.
- [ ] Report the WASM size, and fail above a threshold.

**Acceptance criteria**
- [ ] Pull requests touching `contracts/` run the contract checks, and a failure blocks merging.

---

### 64. Generate TypeScript bindings for the contract instead of hand-building ScVals

**Labels:** `stellar` `refactor` `smart-contract` · **Priority:** P3 · **Difficulty:** Medium

**Description**
`EscrowContractService` builds arguments by hand (`sessionIdToScVal`, `addressToScVal`, `amountToScVal`) and decodes `get_pot` with string casts. If a contract function signature or field name changes, the TypeScript code keeps compiling and then fails at runtime.

**Tasks**
- [ ] Generate bindings with `stellar contract bindings typescript`, as part of the build or a checked-in package.
- [ ] Refactor `EscrowContractService` to use the generated client for argument encoding and result decoding.
- [ ] Add a CI check that the bindings are up to date with the contract.

**Acceptance criteria**
- [ ] A contract signature change produces a TypeScript compile error.

---

### 65. Expand contract test coverage

**Labels:** `smart-contract` `testing` · **Priority:** P2 · **Difficulty:** Medium

**Description**
The 11 existing tests cover the main paths. The following are not tested:
- `NotInitialized` errors
- that `open_pot`, `resolve` and `refund` reject non-resolver callers (the tests use `mock_all_auths`)
- refunding a fully `Funded` pot
- staking into a `Resolved` or `Refunded` pot
- `get_config`
- a conservation invariant: the token balance of the contract equals the sum of open stakes

**Tasks**
- [ ] Add tests using `mock_auths` with specific addresses to prove authorization is enforced.
- [ ] Add tests for every `Error` variant.
- [ ] Add a property-style test over random sequences of operations that checks balance conservation.
- [ ] Add a coverage report (`cargo llvm-cov`).

**Acceptance criteria**
- [ ] Every public function and every error variant is exercised.
- [ ] Authorization failures are tested explicitly.

---

### 66. Testnet onboarding: fund accounts and issue LYRIC for new players

**Labels:** `stellar` `feature` `dx` · **Priority:** P2 · **Difficulty:** Medium

**Description**
`StellarConfig.isTestNetwork` is documented as "enables friendbot funding", but nothing uses it. A new player on testnet needs a funded account, a trustline (for a classic asset) and some LYRIC before they can wager, and the backend helps with none of it.

**Tasks**
- [ ] Add `POST /stellar/testnet/fund`, available only on test networks. It calls Friendbot for the linked address and mints or transfers a configurable LYRIC amount from a faucet account.
- [ ] Rate-limit it per user.
- [ ] Return the balances after funding.
- [ ] Add tests with the RPC and Friendbot calls mocked.

**Acceptance criteria**
- [ ] On testnet, a newly linked wallet can be made wager-ready with one API call.
- [ ] The endpoint does not exist on `public`.

---

### 67. Check trustlines before a wager so payouts cannot fail

**Labels:** `stellar` `wagers` · **Priority:** P1 · **Difficulty:** Medium

**Description**
If LYRIC is a classic asset behind a Stellar Asset Contract, a player without a trustline can still be matched. Their stake transfer fails, which is recoverable. More seriously, if a winner removes their trustline after staking, the `resolve` transfer to them fails and the pot cannot be paid out.

**Tasks**
- [ ] Use Horizon (see issue #74) or the SAC to check the trustline, and that it is authorized, when a wallet is linked and when a wager is created or accepted.
- [ ] Return a clear error that tells the player to add a trustline.
- [ ] Document the recovery procedure: refund if the winner cannot receive.
- [ ] Add tests.

**Acceptance criteria**
- [ ] Players without a usable trustline cannot join a wager, and see a message explaining why.

---

### 68. Verify the on-chain contract config at boot and in health checks

**Labels:** `stellar` `reliability` · **Priority:** P2 · **Difficulty:** Easy

**Description**
Boot validates that the contract IDs are well-formed, but not that the deployed escrow's `get_config().resolver` equals our resolver key, or that its `token` equals `STELLAR_TOKEN_CONTRACT_ID`. A mismatch is only discovered when the first `open_pot` fails.

**Tasks**
- [ ] In stellar mode, call `get_config` at startup. Log an error, or fail the boot if `STELLAR_STRICT_BOOT=true`, when the config does not match.
- [ ] Include the comparison in `GET /stellar/health`.
- [ ] Add tests.

**Acceptance criteria**
- [ ] A resolver or token mismatch is reported at boot and in the health endpoint.

---

### 69. Add an endpoint for the current stake-signature status of a wager

**Labels:** `stellar` `wagers` `feature` · **Priority:** P2 · **Difficulty:** Easy

**Description**
A client that reloads after `POST /game-sessions` loses `pendingSignatures`. It cannot find out which player still needs to sign, or get the transaction again. `GET /game-sessions/:id/wager` returns the raw entity with both players' data.

**Tasks**
- [ ] Add `GET /game-sessions/:id/wager/status`, returning per-player staking state (`pending_signature`, `submitted`, `confirmed`) and, for the caller only, the current unsigned transaction.
- [ ] Shape it with a response DTO (see issue #73).
- [ ] Add tests.

**Acceptance criteria**
- [ ] A reconnecting client can resume the staking handshake from this endpoint alone.

---

### 70. Let players abandon or forfeit a wagered match

**Labels:** `wagers` `feature` `gameplay` · **Priority:** P2 · **Difficulty:** Medium

**Description**
`GameSessionStatus.ABANDONED` exists, but nothing sets it. There is no way for a player to cancel before staking is complete, or to forfeit (conceding the pot) during a match.

**Tasks**
- [ ] Add `POST /game-sessions/:id/cancel`, allowed before `STAKED`, which refunds whatever was staked.
- [ ] Add `POST /game-sessions/:id/forfeit`, allowed after `STAKED`, which pays the opponent.
- [ ] Define the rules for disconnects and time-outs, together with issue #86.
- [ ] Add tests for each state transition.

**Acceptance criteria**
- [ ] Cancel and forfeit move funds correctly, and set the session to `ABANDONED` or `COMPLETED`.

---

### 71. Admin tools to grant mock balances in mock mode

**Labels:** `mock-mode` `admin` `dx` `good first issue` · **Priority:** P3 · **Difficulty:** Easy

**Description**
In mock mode, every user starts with 100 LYRIC (`mockBalance` default), and there is no way to top up during testing or demos, short of editing the database.

**Tasks**
- [ ] Add `POST /admin/users/:id/mock-balance` (admin only, mock mode only) to set or add a balance, validated with `toStroops`.
- [ ] Return `404` or `403` when `STELLAR_SETTLEMENT_MODE=stellar`.
- [ ] Add tests.

**Acceptance criteria**
- [ ] Admins can adjust mock balances in mock mode, and the endpoint is unavailable in stellar mode.

---

### 72. Read the token's decimals from the contract instead of hardcoding 7

**Labels:** `stellar` `tokens` · **Priority:** P3 · **Difficulty:** Medium

**Description**
`TOKEN_DECIMALS = 7` is a constant. Stellar Asset Contracts always use 7 decimals, but a custom Soroban token can use a different number. All display conversions (`fromStroops` and `toStroops`) would then be wrong by powers of ten.

**Tasks**
- [ ] In stellar mode, call `decimals()` on the token contract at boot, and store the result in `StellarConfig`.
- [ ] Thread the decimals value through the `amount.util` functions, keeping 7 as the default.
- [ ] Refuse to boot if the on-chain decimals differ from an explicit `STELLAR_TOKEN_DECIMALS` value.
- [ ] Update the unit tests.

**Acceptance criteria**
- [ ] Display amounts are correct for tokens with any number of decimals.

---

### 73. Paginate and shape wager API responses

**Labels:** `wagers` `api` · **Priority:** P2 · **Difficulty:** Easy

**Description**
`GET /game-sessions/wagers/my-history` and `GET /game-sessions/:id/wager` return raw `Wager` entities. These include full `playerA`, `playerB` and `winner` users (issue #27), internal columns, and amounts only in stroops. There is no pagination beyond an unvalidated `limit`.

**Tasks**
- [ ] Create a `WagerResponseDto` with the stake and pot as `{ stroops, display }`, a status, the opponent summary, the outcome from the caller's point of view (won, lost, refunded or pending) and explorer links for the transaction hashes.
- [ ] Add cursor or offset pagination, and filters by status.
- [ ] Add tests.

**Acceptance criteria**
- [ ] Wager responses carry no raw user entities, and are paginated.

---

### 74. Use `STELLAR_HORIZON_URL` or remove it

**Labels:** `stellar` `refactor` `good first issue` · **Priority:** P3 · **Difficulty:** Easy

**Description**
`horizonUrl` is configured, validated and returned from `/stellar/info`, but no code calls Horizon. Either it should be used (account existence and trustline checks for issues #66 and #67, and payment history), or it should be removed so operators do not configure it for nothing.

**Tasks**
- [ ] Decide: use Horizon for account and trustline lookups, or remove it.
- [ ] If kept, add a small `HorizonService` with `loadAccount` and `hasTrustline`, with tests.
- [ ] Update `.env.example` and the README.

**Acceptance criteria**
- [ ] Every configured Stellar endpoint is used by at least one code path, or has been removed.

---

### 75. Allow signing up with a wallet

**Labels:** `stellar` `auth` `feature` · **Priority:** P3 · **Difficulty:** Medium

**Description**
`POST /auth/stellar/login` only works if the wallet is already linked, which requires a password account first. Web3-native players have to create an email and password they will never use again.

**Tasks**
- [ ] Add `POST /auth/stellar/signup` that verifies a SEP-10 challenge and creates an account with that address, a chosen username and no password (make `passwordHash` nullable, with a migration).
- [ ] Block password login for accounts that have no password.
- [ ] Allow adding an email and password to the account later.
- [ ] Add tests.

**Acceptance criteria**
- [ ] A player can create an account with only a wallet signature, and play wagered matches.
## 4. Gameplay

### 76. Unify the genre and category taxonomy

**Labels:** `refactor` `gameplay` `database` · **Priority:** P1 · **Difficulty:** Medium

**Description**
Four separate vocabularies describe music style:
- `Genre`, for lyrics: `Afrobeats`, `Hip-Hop`, `Pop`, `Other`
- `GameCategory`, for sessions: `Afrobeats`, `90s R&B`, `Hip Hop`, `Pop`, `Rock`
- `MusicGenre`, for user preferences: 20 values, including `Hip Hop`
- `Lyrics.category`: free text

They do not line up. "Hip-Hop" and "Hip Hop" are different strings, a session in category `Rock` can never be served a lyric because no lyric has that genre, and preferences cannot be used to pick lyrics.

**Tasks**
- [ ] Define one canonical `Genre` enum (or a `genres` lookup table), and map `GameCategory` and `MusicGenre` onto it.
- [ ] Write a data migration that converts existing values.
- [ ] Make session creation select lyrics from the session's category.
- [ ] Update the DTOs, Swagger enums and seed data.

**Acceptance criteria**
- [ ] One source of truth for genres, used by lyrics, sessions and preferences.
- [ ] Every allowed category has at least one servable lyric in the seed data.

---

### 77. Normalize how decades are represented

**Labels:** `refactor` `lyrics` `validation` · **Priority:** P2 · **Difficulty:** Easy

**Description**
Decades are handled in three incompatible ways:
- `CreateLyricsDto.decade` is an integer year (1900 to the current year), but only multiples of 10 are valid when *filtering*.
- The column is a `varchar(10)`.
- User preferences use `'1990s'`, and the game DTO takes a free string.

A lyric created with `decade: 1994` can never be found by the decade filter.

**Tasks**
- [ ] Store `decade` as a `smallint` that is a multiple of 10 (with a migration), and validate that in the DTO (`@IsIn([1960, …])` or a custom validator).
- [ ] Map `MusicDecade` values to integers.
- [ ] Accept both `1990` and `1990s` on input, and always output one format.
- [ ] Add tests.

**Acceptance criteria**
- [ ] Every stored decade is filterable.
- [ ] The API uses one consistent decade format.

---

### 78. Award XP and update levels on correct guesses

**Labels:** `feature` `gameplay` `xp` · **Priority:** P1 · **Difficulty:** Medium

**Description**
The README describes XP and five level titles, and `XpLevelService` implements the thresholds, but nothing calls it. Solo guesses, room guesses and session results never change `user.xp`, `level` or `levelTitle`, so every player stays a "Gossip Rookie" forever.

**Tasks**
- [ ] Provide `XpLevelService` through an `XpModule` (see issue #16).
- [ ] After a correct guess (solo, room or session), add XP inside a transaction with a row lock, and recompute `level` and `levelTitle`.
- [ ] Return `xpGained`, `totalXp`, `level`, `levelTitle` and `leveledUp` in the guess response.
- [ ] Emit `user.leveled_up` when the level changes (see issue #82).
- [ ] Make the XP amounts configurable, for example by difficulty.
- [ ] Add unit and e2e tests.

**Acceptance criteria**
- [ ] A correct guess increases the player's XP, and crossing a threshold updates the level and title.
- [ ] Concurrent guesses never lose XP updates.

---

### 79. Record every guess in `game_history`

**Labels:** `feature` `gameplay` `game-history` · **Priority:** P1 · **Difficulty:** Medium

**Description**
`GameHistoryService.create` is exported but never called, so `/game-history/me` and `/me/stats` are always empty. Solo guesses (HTTP and WebSocket), room guesses and session play should all be written to the history table.

**Tasks**
- [ ] Inject `GameHistoryService` into the game, rooms and sessions flows, and record `playerId`, `lyricId`, `gameSessionId`, `guessType`, `guessValue`, `isCorrect`, `pointsAwarded` and `xpChange`.
- [ ] Do the write in the same transaction as the XP update (issue #78).
- [ ] Change `game_history.wagerAmount` to `bigint` stroops, to match the wager columns (with a migration).
- [ ] Add e2e tests showing history and stats update after play.

**Acceptance criteria**
- [ ] Each guess creates exactly one history row.
- [ ] `/game-history/me/stats` reflects real play.

---

### 80. Apply the streak bonus and difficulty multipliers

**Labels:** `feature` `gameplay` `scoring` · **Priority:** P2 · **Difficulty:** Medium

**Description**
`GAME_CONSTANTS` defines `STREAK_BONUS` (25) and difficulty multipliers of ×1, ×1.5 and ×2, and the README advertises them. `GameLogicService` uses only its own hardcoded 100 and 50 points. The constants are unused, and `Lyrics.difficulty` (1–5) is never taken into account.

**Tasks**
- [ ] Use `GAME_CONSTANTS` as the single source of point values.
- [ ] Map `Lyrics.difficulty` to easy, medium or hard, and apply the multiplier.
- [ ] Track the player's streak on the server (in the round or session state from issue #36), and add the streak bonus.
- [ ] Return a points breakdown, filling the `bonus` field of `GuessResultResponse`.
- [ ] Add unit tests for every combination.

**Acceptance criteria**
- [ ] Scores match the README table, including streak and difficulty.
- [ ] Clients receive a breakdown of how the points were calculated.

---

### 81. Improve answer matching: accents, "feat.", articles and typos

**Labels:** `feature` `gameplay` `bug` · **Priority:** P1 · **Difficulty:** Medium

**Description**
`normalizeString` strips characters with `/[^\w\s]/g` (`src/game/game.service.ts:354`). `\w` covers ASCII only, so "Beyoncé" becomes "beyonc", and accented Afrobeats and Latin artist names are mangled. A correct answer typed with the accent is matched against a corrupted string. Partial matches use raw `includes`, so "the" matches "The Weeknd" once it is at least 3 characters long. `string-similarity` is a dependency but is not used for solo play.

**Tasks**
- [ ] Normalize with `normalize('NFD').replace(/\p{Diacritic}/gu, '')`, and use a Unicode-aware `/[^\p{L}\p{N}\s]/gu`.
- [ ] Strip "feat."/"ft."/"featuring" clauses, leading "the", and bracketed suffixes ("(Remix)").
- [ ] Use a similarity threshold (for example, Dice ≥ 0.85 counts as correct and ≥ 0.6 as partial) instead of substring matching, and ignore stop-word-only guesses.
- [ ] Share one matcher between solo play, rooms and sessions.
- [ ] Add a table-driven test suite with real artist names.

**Acceptance criteria**
- [ ] "Beyoncé", "beyonce" and "BEYONCÉ" all match "Beyoncé".
- [ ] "the" does not score a partial match against "The Weeknd".

---

### 82. Send notifications from real gameplay events and store them

**Labels:** `feature` `notifications` · **Priority:** P2 · **Difficulty:** Medium

**Description**
The notifications module only stores events emitted through its own mock endpoints, in an in-memory array that is lost on restart and grows without limit. No gameplay code emits `user.leveled_up`, `user.completed_challenge` or `user.achievement_unlocked`. `EventEmitterModule.forRoot()` is also imported inside a feature module rather than in `AppModule`.

**Tasks**
- [ ] Move `EventEmitterModule.forRoot()` to `AppModule`.
- [ ] Emit events from XP, level, streak, wager and room flows.
- [ ] Add a `notifications` table (id, userId, type, payload, readAt, createdAt), with a migration.
- [ ] Add `GET /notifications/me` (paginated) and `PATCH /notifications/:id/read`.
- [ ] Push notifications to connected clients over WebSocket (see issue #85).
- [ ] Add tests.

**Acceptance criteria**
- [ ] Levelling up creates a stored notification that the user can list and mark as read.
- [ ] Notifications survive a restart.

---

### 83. Run head-to-head matches on the server

**Labels:** `feature` `gameplay` `wagers` · **Priority:** P0 · **Difficulty:** Hard

**Description**
Head-to-head sessions have no gameplay of their own. There are no rounds, no shared lyrics and no guess submission tied to a session. The only way to finish one is to post both scores to `complete-wagered` (see issue #30). For wagered play, the server must be the referee.

**Tasks**
- [ ] Design a `session_rounds` model: `sessionId`, `roundNumber`, `lyricId`, `startedAt` and `endsAt`, with one guess per player per round.
- [ ] Add `POST /game-sessions/:id/start` (both players ready, wager `STAKED`), `GET /game-sessions/:id/round` and `POST /game-sessions/:id/rounds/:n/guess`.
- [ ] Score each round on the server with the shared matcher (issue #81), and update `score` and `playerTwoScore`.
- [ ] After the last round, decide the winner or a draw, and call the wager service automatically.
- [ ] Handle a player who does not answer (zero points) and disconnects (see issue #70).
- [ ] Add a full e2e test in mock mode: create, accept, stake, play, settle.

**Acceptance criteria**
- [ ] A wagered match can be played from start to settlement without any client-reported score.
- [ ] Both players always receive the same lyrics in the same order.

---

### 84. Invitation flow for multiplayer sessions: accept and decline

**Labels:** `feature` `gameplay` `game-sessions` · **Priority:** P1 · **Difficulty:** Medium

**Description**
Sessions in `WAITING_FOR_PLAYER` have no way to leave that state. Player two cannot see pending invitations, accept or decline. This is also the fix for issue #31.

**Tasks**
- [ ] Add `GET /game-sessions/invitations` (pending sessions where the caller is player two).
- [ ] Add `POST /game-sessions/:id/accept`, which moves the session to `IN_PROGRESS` and, for wagers, stakes player two or returns their transaction to sign.
- [ ] Add `POST /game-sessions/:id/decline`, which moves the session to `ABANDONED` and refunds player one.
- [ ] Expire invitations after a configurable time.
- [ ] Notify player two (issue #82).
- [ ] Add tests.

**Acceptance criteria**
- [ ] Player two can list, accept and decline invitations.
- [ ] Declined and expired invitations release all funds.

---

### 85. Real-time multiplayer over WebSockets

**Labels:** `feature` `websocket` `gameplay` · **Priority:** P2 · **Difficulty:** Hard

**Description**
The gateway only supports solo play. Rooms and head-to-head sessions are polled over HTTP, so opponents cannot see each other's progress, and clients cannot be told that a round has started or a wager has been settled.

**Tasks**
- [ ] Add Socket.IO rooms per game session and per room.
- [ ] Emit `session.player_joined`, `round.started`, `round.ended`, `session.completed`, `wager.staked` and `wager.settled`.
- [ ] Use the `@socket.io/redis-adapter` for multi-instance deployments (see issue #115).
- [ ] Document the event contract in the README or an AsyncAPI file.
- [ ] Add e2e tests with two socket clients.

**Acceptance criteria**
- [ ] Two connected players receive round and result events in real time.
- [ ] The event contract is documented.

---

### 86. Timed rounds and a speed bonus

**Labels:** `feature` `gameplay` · **Priority:** P2 · **Difficulty:** Medium

**Description**
Guesses have no time limit. `SESSION_TIMEOUT_MINUTES` is defined but unused, and the `speed_demon` achievement exists only as a mock. Timed rounds make play fairer, especially for wagers, where a player could otherwise search the web for the answer.

**Tasks**
- [ ] Add a configurable answer window per round (for example, 20 seconds), enforced on the server using `issuedAt`.
- [ ] Reject late guesses, or score them as zero.
- [ ] Add a speed bonus that decreases linearly over the window.
- [ ] Expire idle sessions after `SESSION_TIMEOUT_MINUTES`.
- [ ] Add tests with fake timers.

**Acceptance criteria**
- [ ] Guesses after the window closes earn no points.
- [ ] Faster correct answers earn more points, up to a documented cap.

---

### 87. Daily challenge mode

**Labels:** `feature` `gameplay` · **Priority:** P3 · **Difficulty:** Medium

**Description**
A shared daily set of lyrics, the same for every player, with its own leaderboard, is a proven way to bring players back.

**Tasks**
- [ ] Generate a deterministic daily set (for example, 10 lyrics chosen with a date-seeded random function), cached for the day.
- [ ] Add `GET /challenges/daily` and `POST /challenges/daily/guess`, one attempt per lyric per user.
- [ ] Add `GET /challenges/daily/leaderboard`.
- [ ] Award XP, and emit `user.completed_challenge`.
- [ ] Add tests.

**Acceptance criteria**
- [ ] Every player gets the same set on the same UTC day, and can attempt it only once.

---

### 88. Hints that cost points

**Labels:** `feature` `gameplay` · **Priority:** P3 · **Difficulty:** Easy

**Description**
Players who are stuck have no help available. A hint system, such as revealing the decade, the first letter or the word count, adds depth to play.

**Tasks**
- [ ] Add `POST /game/rounds/:id/hint` with hint levels.
- [ ] Record the hints used on the round, and reduce the maximum points accordingly.
- [ ] Do not allow hints in wagered sessions, or apply them symmetrically.
- [ ] Add tests.

**Acceptance criteria**
- [ ] Hints reveal progressively more, and reduce the points available for that round.

---

### 89. Track lyric usage and calibrate difficulty from real results

**Labels:** `feature` `lyrics` `data` · **Priority:** P3 · **Difficulty:** Medium

**Description**
`Lyrics.timesUsed` is never incremented, and `difficulty` defaults to 0, which is outside the documented 1–5 range. `game_history` already has the data needed to measure how hard each lyric really is.

**Tasks**
- [ ] Increment `timesUsed` atomically when a lyric is served.
- [ ] Add a scheduled job that sets `difficulty` from the correct-guess rate once there are at least N attempts.
- [ ] Add a `CHECK (difficulty BETWEEN 1 AND 5)` constraint, with default 3 (via a migration).
- [ ] Add filtering by difficulty to `/game/lyric`.

**Acceptance criteria**
- [ ] `timesUsed` reflects actual serves.
- [ ] Difficulty values are data-driven, and always between 1 and 5.

---

### 90. Use player preferences when choosing lyrics

**Labels:** `feature` `gameplay` `users` · **Priority:** P3 · **Difficulty:** Easy

**Description**
Users can set `preferredGenre` and `preferredDecade`, but nothing reads them. `/game/lyric` without filters should lean towards the player's preferences.

**Tasks**
- [ ] When no filter is given, apply the user's preferences, falling back to all lyrics if nothing matches.
- [ ] Add an `ignorePreferences=true` query option.
- [ ] Depends on issue #76 (taxonomy) and issue #77 (decades).
- [ ] Add tests.

**Acceptance criteria**
- [ ] A player with preferences mostly receives matching lyrics, and never receives an empty result because of them.

---

### 91. Rooms: host, player limit, start and results

**Labels:** `feature` `rooms` · **Priority:** P2 · **Difficulty:** Medium

**Description**
Rooms have no owner and no player limit. They cannot be started or closed by anyone, and there is no results view. They are single-lyric, and the "winner" is never determined.

**Tasks**
- [ ] Add `hostId`, `maxPlayers`, `status` (`lobby`, `playing`, `finished`) and `roundCount` to `Room` (with a migration).
- [ ] Add endpoints for the host to start and close the room.
- [ ] Add `GET /rooms/:id/results` with a ranked list, once the room is finished or the caller has guessed.
- [ ] Award XP to the top finishers.
- [ ] Add tests.

**Acceptance criteria**
- [ ] The host controls the room's lifecycle.
- [ ] Results are ranked and cannot be seen before guessing.

---

### 92. Rooms: list open rooms and join by short code

**Labels:** `feature` `rooms` `good first issue` · **Priority:** P3 · **Difficulty:** Easy

**Description**
Players can only join a room if they already know its UUID. There is no lobby list and no short, shareable code.

**Tasks**
- [ ] Add a unique 6-character `code` to `Room`, generated on creation.
- [ ] Add `POST /rooms/join/:code` and `GET /rooms?status=lobby` (paginated).
- [ ] Add tests.

**Acceptance criteria**
- [ ] Players can find open rooms and join them with a short code.

---

### 93. Persist achievements

**Labels:** `feature` `gameplay` `notifications` · **Priority:** P3 · **Difficulty:** Medium

**Description**
Achievement types (`perfect_guess`, `streak`, `first_win` and `speed_demon`) exist only as mock notifications. Nothing awards them or stores them.

**Tasks**
- [ ] Add `achievements` (definitions) and `user_achievements` tables, with a migration.
- [ ] Award achievements from gameplay events (first correct guess, a streak of 5 or 10, first wager won, a fast answer).
- [ ] Add `GET /users/me/achievements`.
- [ ] Emit `user.achievement_unlocked` (issue #82).
- [ ] Add tests, including that an achievement is only awarded once.

**Acceptance criteria**
- [ ] Achievements are awarded once each, stored, and listed on the profile.

---

### 94. Friends and direct challenges

**Labels:** `feature` `social` · **Priority:** P3 · **Difficulty:** Medium

**Description**
To start a head-to-head match you need the opponent's UUID. A friends list makes direct challenges practical.

**Tasks**
- [ ] Add a `friendships` table (requester, addressee, status), with a migration.
- [ ] Add endpoints to send, accept, decline and remove friend requests, and to list friends.
- [ ] Allow `playerTwoUsername` as an alternative to `playerTwoId` when creating a session.
- [ ] Add tests.

**Acceptance criteria**
- [ ] Players can add friends and challenge them by username.

---

### 95. Leaderboards: time periods, public access and active users only

**Labels:** `feature` `leaderboard` · **Priority:** P2 · **Difficulty:** Medium

**Description**
`GET /users/leaderboard` ranks every user, including inactive and admin accounts, by lifetime XP only, and requires authentication. There are no weekly or monthly boards, and no board per genre.

**Tasks**
- [ ] Exclude inactive users, and optionally admins.
- [ ] Add `period=weekly|monthly|all` using aggregates from `game_history`, backed by a materialized view or cached query.
- [ ] Add `genre=` filtering.
- [ ] Mark the endpoint `@Public()` and return only public fields.
- [ ] Add a "my rank" field for the authenticated caller.
- [ ] Add tests.

**Acceptance criteria**
- [ ] Weekly, monthly and all-time leaderboards are available without logging in, and exclude inactive users.

---

### 96. Avoid repeating lyrics a player has already seen

**Labels:** `feature` `gameplay` · **Priority:** P3 · **Difficulty:** Medium

**Description**
`excludeIds` only covers the current request, or the last lyric on the WebSocket gateway. Players see the same lyrics repeatedly across sessions, which also makes it easy to memorize answers.

**Tasks**
- [ ] Exclude lyrics the user has guessed in the last N days, using `game_history` or a Redis set.
- [ ] Fall back gracefully when the pool is exhausted.
- [ ] Replace the `COUNT` + random `OFFSET` query with a more efficient random selection (for example, `TABLESAMPLE` or a random-key index).
- [ ] Add tests.

**Acceptance criteria**
- [ ] A player does not see the same lyric twice within the configured window while unseen lyrics remain.

---

### 97. `top-scores` ignores player two and has no pagination

**Labels:** `bug` `game-sessions` `leaderboard` · **Priority:** P3 · **Difficulty:** Easy

**Description**
`getTopScores` orders only by `score`, which is player one's score. A player-two score of 1000 never appears. The response also embeds full `player` entities (see issue #27).

**Tasks**
- [ ] Build a query that combines both player columns (for example, a `UNION` or `GREATEST` with attribution).
- [ ] Add pagination (issue #25) and filters by mode and category.
- [ ] Return a shaped DTO.
- [ ] Add tests.

**Acceptance criteria**
- [ ] High scores from either seat appear, attributed to the correct user.

---

## 5. Lyrics content management

### 98. Bulk import lyrics from CSV or JSON

**Labels:** `feature` `lyrics` `admin` · **Priority:** P2 · **Difficulty:** Medium

**Description**
Lyrics can only be created one at a time, and that endpoint is currently broken (issues #1, #2 and #14). Building a playable catalogue needs a bulk path.

**Tasks**
- [ ] Add `POST /admin/lyrics/import` (multipart CSV or JSON), validating every row against `CreateLyricsDto`.
- [ ] Add a dry-run mode that returns the errors for each row.
- [ ] Upsert on `(artist, songTitle)`, and report how many rows were created, updated and skipped.
- [ ] Invalidate caches once, after the import.
- [ ] Add tests with a fixture file.

**Acceptance criteria**
- [ ] An admin can import hundreds of lyrics in one request, and gets a per-row report.

---

### 99. Expose lyrics search, and fix its cache key

**Labels:** `feature` `lyrics` `good first issue` · **Priority:** P3 · **Difficulty:** Easy

**Description**
`LyricsService.searchLyrics` is implemented, but no route calls it. Its cache key `search_${term}` does not use the configured `cacheConfig.keys.search` prefix, so prefix-based invalidation (issue #23) would miss it. It also searches answer fields, so it has to be admin-only (issue #35).

**Tasks**
- [ ] Add `GET /admin/lyrics/search?q=` (admin only), with a validated query DTO.
- [ ] Use `cacheConfig.keys.search`, and invalidate it on writes.
- [ ] Add a trigram index (`pg_trgm`) on the searched columns, with a migration.
- [ ] Add tests.

**Acceptance criteria**
- [ ] Admins can search lyrics quickly.
- [ ] Search results are invalidated when lyrics change.

---

### 100. Paginate lyric and admin list endpoints

**Labels:** `performance` `lyrics` `admin` · **Priority:** P2 · **Difficulty:** Easy

**Description**
`GET /lyrics`, `GET /admin/lyrics`, `GET /admin/users` and `GET /lyrics/genre|decade|artist/*` return every matching row, with joins. As the catalogue grows, these responses get slow and large.

**Tasks**
- [ ] Apply the shared `PaginationQueryDto` (issue #25) to these endpoints.
- [ ] Return `{ data, meta: { total, page, limit } }`.
- [ ] Add sorting options.
- [ ] Add tests.

**Acceptance criteria**
- [ ] No list endpoint returns more than the maximum page size.

---

### 101. Let players report wrong lyrics or answers

**Labels:** `feature` `lyrics` `moderation` · **Priority:** P3 · **Difficulty:** Medium

**Description**
A wrong answer in the catalogue unfairly costs players points, and potentially wagers. There is no way for players to flag a problem.

**Tasks**
- [ ] Add a `lyric_reports` table (lyricId, reporterId, reason, status), with a migration.
- [ ] Add `POST /lyrics/:id/report` (rate-limited), and admin endpoints to list and resolve reports.
- [ ] Automatically deactivate a lyric after N distinct reports, pending review.
- [ ] Add tests.

**Acceptance criteria**
- [ ] Players can report a lyric, and admins can review and resolve reports.

---

### 102. Accept alternative answers (aliases)

**Labels:** `feature` `lyrics` `gameplay` · **Priority:** P2 · **Difficulty:** Medium

**Description**
Many artists and titles have several legitimate spellings: "Jay-Z" and "JAY Z", "Wizkid" and "WizKid", "Burna Boy" and "Burna". Similarity scoring (issue #81) helps, but explicit aliases are more reliable.

**Tasks**
- [ ] Add `artistAliases` and `titleAliases` (`text[]`) to `Lyrics`, with a migration.
- [ ] Match guesses against the canonical value and every alias.
- [ ] Support aliases in the create, update and bulk-import DTOs.
- [ ] Add tests.

**Acceptance criteria**
- [ ] A guess that matches an alias is scored as correct.

---

### 103. Admin: view and restore deactivated lyrics

**Labels:** `feature` `admin` `lyrics` `good first issue` · **Priority:** P3 · **Difficulty:** Easy

**Description**
Soft-deleted lyrics (`isActive = false`) are hidden from every endpoint, admin ones included. An admin cannot see what was removed, or undo a mistaken deletion.

**Tasks**
- [ ] Add `GET /admin/lyrics?status=inactive`.
- [ ] Add `POST /admin/lyrics/:id/restore`.
- [ ] Invalidate caches on restore.
- [ ] Add tests.

**Acceptance criteria**
- [ ] Admins can list and restore deactivated lyrics.

---

### 104. Limit snippet length and document the content policy

**Labels:** `lyrics` `legal` `validation` · **Priority:** P2 · **Difficulty:** Easy

**Description**
`content` holds the full lyric text, with no length limit. Storing and serving full copyrighted lyrics carries licensing risk. The game only needs a short snippet and the answer metadata.

**Tasks**
- [ ] Enforce a maximum `lyricSnippet` length (for example, 150 characters or 2 lines) in the DTO.
- [ ] Make `content` optional, or restrict it to admins, and never serve it to players.
- [ ] Add a `CONTENT_POLICY.md` covering sourcing, attribution and takedown requests.
- [ ] Add tests.

**Acceptance criteria**
- [ ] Snippets over the limit are rejected.
- [ ] Full lyric text is never served to players.
## 6. Users and accounts

### 105. Verify email addresses

**Labels:** `feature` `auth` `users` · **Priority:** P2 · **Difficulty:** Medium

**Description**
Accounts are active as soon as they sign up, with no proof that the user owns the email address. That allows throwaway accounts (and wager-invite spam once social features ship), and leaves no reliable channel for password resets.

**Tasks**
- [ ] Add `emailVerifiedAt` to `User` (with a migration), and an `email_tokens` table for hashed, single-use tokens.
- [ ] Add a `MailerService` abstraction with a console driver for development and an SMTP driver for production.
- [ ] Add `POST /auth/verify-email` and `POST /auth/resend-verification` (rate-limited).
- [ ] Require a verified email for wagered play (make this configurable).
- [ ] Add tests.

**Acceptance criteria**
- [ ] New users receive a verification link, and are marked verified once they use it.

---

### 106. Password reset flow

**Labels:** `feature` `auth` · **Priority:** P2 · **Difficulty:** Medium

**Description**
A user who forgets their password has no way back into their account.

**Tasks**
- [ ] Add `POST /auth/forgot-password`, which always returns `200` so that it does not reveal whether an account exists.
- [ ] Add `POST /auth/reset-password` with a hashed, single-use, time-limited token.
- [ ] Invalidate existing sessions after a reset (see issue #41).
- [ ] Add rate limiting (issue #38) and tests.

**Acceptance criteria**
- [ ] A user can reset their password by email, and each reset token works only once.

---

### 107. Change password while signed in

**Labels:** `feature` `auth` `good first issue` · **Priority:** P3 · **Difficulty:** Easy

**Description**
A signed-in user cannot change their password.

**Tasks**
- [ ] Add `POST /auth/change-password`, which requires the current password and applies the strength rules from issue #43.
- [ ] Invalidate other sessions (issue #41).
- [ ] Add tests.

**Acceptance criteria**
- [ ] A user can change their password after confirming the current one.

---

### 108. Self-service profile updates and a richer profile

**Labels:** `feature` `users` · **Priority:** P2 · **Difficulty:** Easy

**Description**
`GET /users/profile` omits `levelTitle`, the linked wallet, the balance and stats. There is no safe way for users to update their own display name or username: the only update route is the unprotected `PATCH /users/:id` (issue #28), and its DTO has no validators.

**Tasks**
- [ ] Add `GET /users/me` (and keep `/users/profile` as an alias) returning the profile, `levelTitle`, the wallet, the balance summary and stats.
- [ ] Add `PATCH /users/me` with a validated `UpdateProfileDto` (`name`, `username`, and optionally an avatar URL).
- [ ] Enforce username uniqueness and format (issue #43).
- [ ] Add tests.

**Acceptance criteria**
- [ ] Users can view and edit their own profile.
- [ ] Invalid or duplicate usernames are rejected.

---

### 109. Account deletion and data export

**Labels:** `feature` `users` `privacy` · **Priority:** P2 · **Difficulty:** Medium

**Description**
Users cannot delete their own account or export their data, which privacy regulations such as GDPR and NDPR require. Deletion also has to respect financial records (issue #44).

**Tasks**
- [ ] Add `DELETE /users/me`: require re-authentication, block the request while a wager is active, then anonymize the account (email, username, name and wallet) and deactivate it.
- [ ] Add `GET /users/me/export`, returning a JSON bundle of the profile, game history and wagers.
- [ ] Document retention of anonymized wager records.
- [ ] Add tests.

**Acceptance criteria**
- [ ] A user can delete their account, after which their personal data is anonymized and they can no longer sign in.
- [ ] A user can download their data.

---

### 110. Public player profiles

**Labels:** `feature` `users` `social` · **Priority:** P3 · **Difficulty:** Easy

**Description**
`GET /users/:id` returns the full entity to any logged-in user (issue #27). There is no safe public view for showing opponents or leaderboard entries.

**Tasks**
- [ ] Add `GET /users/:username/public`, returning username, level, level title, XP, achievements and win rate.
- [ ] Restrict `GET /users/:id` to admins.
- [ ] Add tests.

**Acceptance criteria**
- [ ] Public profiles expose only deliberately public fields.

---

## 7. Infrastructure, DevOps and developer experience

### 111. Add a Dockerfile and docker-compose for local development

**Labels:** `devops` `dx` · **Priority:** P2 · **Difficulty:** Easy

**Description**
To run locally, a contributor has to install Postgres, create a database and configure `.env` by hand. There is no container image for deployment.

**Tasks**
- [ ] Add a multi-stage `Dockerfile` (build with `npm ci`, then run as a non-root user with production dependencies only).
- [ ] Add a `docker-compose.yml` with `postgres:16`, the app, an optional `stellar/quickstart` on the `--profile stellar`, and Redis (issue #115).
- [ ] Add an entrypoint that runs migrations before starting.
- [ ] Add a `.dockerignore`.
- [ ] Document the setup in the README.

**Acceptance criteria**
- [ ] `docker compose up` starts a working API with a migrated database.

---

### 112. GitHub Actions CI for lint, type-check, tests and build

**Labels:** `devops` `testing` · **Priority:** P1 · **Difficulty:** Easy

**Description**
The repository has no CI. The history shows the suite drifting into a failing state (fixed in `1c58a96`), and nothing prevents it from happening again.

**Tasks**
- [ ] Add a workflow that runs, on every PR: `npm ci`, `npm run lint` (in check mode rather than `--fix`), `tsc --noEmit`, `npm test -- --coverage` and `npm run build`.
- [ ] Add an e2e job with a Postgres service container (issue #119), and a migration drift check (issue #4).
- [ ] Add the contract job (issue #63).
- [ ] Add status badges to the README.

**Acceptance criteria**
- [ ] Every PR runs the full pipeline, and failures block merging.

---

### 113. Proper health and readiness endpoints

**Labels:** `devops` `reliability` · **Priority:** P2 · **Difficulty:** Easy

**Description**
`GET /` returns "Hello World!", `GET /game/health` always returns OK, and `/stellar/health` checks only the RPC. None of them is public except `/stellar/health`, none checks the database, and none is suitable for Kubernetes or load-balancer probes.

**Tasks**
- [ ] Add `@nestjs/terminus` with `GET /health/live` (process up) and `GET /health/ready` (database ping, the RPC in stellar mode, and the cache).
- [ ] Mark both endpoints `@Public()`.
- [ ] Remove the "Hello World" controller and `/game/health`, or redirect them.
- [ ] Add tests.

**Acceptance criteria**
- [ ] Readiness fails when the database is unreachable.
- [ ] The probe endpoints require no auth.

---

### 114. Structured logging with Winston and request IDs

**Labels:** `devops` `logging` · **Priority:** P2 · **Difficulty:** Medium

**Description**
`LoggerService` (Winston with daily-rotating files) is written but never used. The app logs through Nest's default console logger. `CommonModule` is commented out, and no request ID ties together the log lines from one request. Writing log files inside a container is also usually the wrong choice.

**Tasks**
- [ ] Register the Winston logger as the app logger (`app.useLogger`), using JSON format in production and a readable format in development.
- [ ] Make file transports optional (`LOG_TO_FILE`), and default to stdout.
- [ ] Add middleware that reads or generates `x-request-id` and adds it to every log line (via `AsyncLocalStorage`).
- [ ] Delete the dead `CommonModule`.
- [ ] Add tests.

**Acceptance criteria**
- [ ] Every log line in production is JSON and includes `requestId`.
- [ ] No unused logging code remains.

---

### 115. Use Redis for the cache so multiple instances stay consistent

**Labels:** `devops` `performance` `caching` · **Priority:** P2 · **Difficulty:** Medium

**Description**
The cache is in process memory. With more than one instance, invalidation on one instance does not reach the others (issue #23), and the cache is lost on every deploy. Redis is also needed for issues #40, #85 and #96.

**Tasks**
- [ ] Add a Keyv/Redis store for `cache-manager`, configured with `REDIS_URL`, and fall back to memory when it is unset.
- [ ] Implement prefix invalidation with a key-set or versioned namespace strategy (issue #23).
- [ ] Add Redis to docker-compose (issue #111).
- [ ] Update `docs/CACHING_IMPLEMENTATION.md`.

**Acceptance criteria**
- [ ] With `REDIS_URL` set, two instances share the cache, and an invalidation on one is seen by the other.

---

### 116. Make TypeORM query logging configurable

**Labels:** `devops` `performance` `database` · **Priority:** P2 · **Difficulty:** Easy

**Description**
`AppModule` hardcodes `logging: ['query', 'error']` (`src/app.module.ts:91`). In production this logs every SQL statement, parameters included, which is noisy, slow and can leak data. The connection pool size (`poolSize: 10`) is also hardcoded.

**Tasks**
- [ ] Read `DB_LOGGING` (for example, `error,warn,slow`) and `DB_POOL_SIZE` from config.
- [ ] Keep `maxQueryExecutionTime` for slow-query warnings, with the threshold configurable.
- [ ] Document these settings in `docs/DATABASE_MONITORING.md`.

**Acceptance criteria**
- [ ] Production logs contain only errors and slow queries by default.

---

### 117. Read-replica configuration: port type, and stale reads after writes

**Labels:** `database` `bug` `reliability` · **Priority:** P2 · **Difficulty:** Medium

**Description**
Two problems with the read replica:
- `DB_REPLICA_PORT` is read with `configService.get<number>`, but environment variables are strings, so the port is the string `"5432"`.
- With replication enabled, TypeORM sends `find*` calls to the replica. Flows that write and then read straight away (such as saving a wager and then calling `requireWager`, or updating a balance and then calling `getUserBalance`) can read stale data when the replica lags behind. For money flows, that is dangerous.

**Tasks**
- [ ] Parse the replica port with `parseInt`.
- [ ] Route reads in wager, token and auth flows to the primary: use `QueryRunner` with `'master'`, or run them inside transactions.
- [ ] Only enable replication when `DB_REPLICA_HOST` is set, so that a single-database setup has no replication layer at all.
- [ ] Document when reads go to the replica.

**Acceptance criteria**
- [ ] Money-moving flows never read from the replica.
- [ ] A single-database setup has no replication configuration.

---

### 118. Complete the Swagger and OpenAPI documentation

**Labels:** `docs` `api` · **Priority:** P2 · **Difficulty:** Easy

**Description**
The Swagger setup does not call `.addBearerAuth()`, so "Authorize" does not work for most routes. Many handlers (game, rooms, game history, admin) have no `@ApiTags`, no response types and no documented error codes. Several request bodies are inline types with no schema.

**Tasks**
- [ ] Add `.addBearerAuth()`, and apply `@ApiBearerAuth()` globally, excluding `@Public()` routes.
- [ ] Add response DTO classes, and `@ApiOkResponse({ type })` everywhere.
- [ ] Add `@nestjs/swagger`'s CLI plugin to `nest-cli.json` so DTO properties are documented automatically.
- [ ] Export `openapi.json` in CI, and fail on breaking changes (for example, with `oasdiff`).

**Acceptance criteria**
- [ ] Every route in Swagger has a tag, auth information, a request schema and a response schema.
- [ ] "Authorize" works.

---

### 119. Run end-to-end tests against a real Postgres database

**Labels:** `testing` · **Priority:** P1 · **Difficulty:** Medium

**Description**
Unit tests mock every repository, so SQL-level bugs pass them: the `lower(enum)` crash (issue #17), the migration problems (issue #4), and the decade type mismatches. `test/app.e2e-spec.ts` only checks the "Hello World" route, and `jest-e2e.json` lacks the `src/` path mapping and the ESM transform settings that the unit config has.

**Tasks**
- [ ] Use `@testcontainers/postgresql`, or the CI service container, to start Postgres, run migrations and seed.
- [ ] Align `jest-e2e.json` with `jest.config.js` (`moduleNameMapper` and `transformIgnorePatterns`).
- [ ] Write e2e flows for: signup and login, playing a solo round, a room, the mock wagered match, and the admin lyric CRUD.
- [ ] Add an `npm run test:e2e` step to CI (issue #112).

**Acceptance criteria**
- [ ] The e2e suite runs from a clean database and covers the main user journeys.

---

### 120. Remove scaffold leftovers and dead files

**Labels:** `refactor` `good first issue` · **Priority:** P3 · **Difficulty:** Easy

**Description**
The repository contains a number of generated or leftover files:
- empty `auth.entity.ts`, `admin.entity.ts`, `game.entity.ts`, `create-auth.dto.ts`, `update-auth.dto.ts`, `create-admin.dto.ts` and `update-admin.dto.ts`
- a duplicate `Roles` decorator in `auth/decorators/roles.decorator.ts` and `auth/roles/roles.decorator.ts`
- `rooms.controller.spec.ts.bak` and `.tmp`
- `test-caching.js`, which requires `axios`, a package that is not a dependency
- `IMPLEMENTATION_SUMMARY.md`, which describes one past PR
- an unused `game/interfaces/game-session.interface.ts` that clashes by name with the entity
- `GameLogicService` in `game.service.ts` redeclaring a `GuessDto` interface that shadows the DTO class

**Tasks**
- [ ] Delete the empty or duplicate files, and update their imports.
- [ ] Keep one `Roles` decorator.
- [ ] Move anything useful from `IMPLEMENTATION_SUMMARY.md` into `docs/`.
- [ ] Rename `game.service.ts` to `game-logic.service.ts`, or rename the class to match its file.

**Acceptance criteria**
- [ ] No empty classes, backup files or unused scripts remain, and the build and tests still pass.

---

### 121. Tighten TypeScript and ESLint settings

**Labels:** `refactor` `dx` · **Priority:** P3 · **Difficulty:** Medium

**Description**
`tsconfig.json` has `noImplicitAny: false` and does not enable `strict`, and it has no `include`. As a result, `tsc -p tsconfig.json` type-checks `eslint.config.mjs` and fails with TS1343. `npm run lint` runs with `--fix`, which is not suitable for CI.

**Tasks**
- [ ] Add `"include": ["src", "test", "typeorm.config.ts"]`.
- [ ] Enable `strict` step by step (`noImplicitAny` first), fixing the errors one module at a time.
- [ ] Add a `lint:check` script without `--fix`.
- [ ] Enable `@typescript-eslint/no-floating-promises`, which matters for the settlement code.

**Acceptance criteria**
- [ ] `tsc --noEmit -p tsconfig.json` passes.
- [ ] `strict` is enabled without suppressions.

---

### 122. Add a global API prefix and versioning

**Labels:** `api` `refactor` · **Priority:** P3 · **Difficulty:** Easy

**Description**
Routes are served from the root (`/auth`, `/game`, …) with no version. Once mobile or web clients ship, a breaking change such as issue #36 (round IDs) cannot be introduced without breaking them.

**Tasks**
- [ ] Add `app.setGlobalPrefix('api')` and `app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })`.
- [ ] Keep health endpoints outside the prefix.
- [ ] Update the Swagger path, the README and the tests.

**Acceptance criteria**
- [ ] All routes are served under `/api/v1/...`, and health probes stay at the root.

---

### 123. Graceful shutdown that lets in-flight settlements finish

**Labels:** `reliability` `stellar` · **Priority:** P2 · **Difficulty:** Medium

**Description**
`main.ts` does not call `enableShutdownHooks()`. When a container receives `SIGTERM` during a payout, the process can exit between submitting the transaction and recording the result. Reconciliation (issue #53) can recover from that, but it is better to drain first.

**Tasks**
- [ ] Call `app.enableShutdownHooks()`.
- [ ] Track in-flight settlements in `WagerService`, and wait for them (with a timeout) in `onApplicationShutdown`.
- [ ] Stop the scheduled jobs and close the database and Redis connections cleanly.
- [ ] Add a test that simulates `SIGTERM` during a settlement.

**Acceptance criteria**
- [ ] On `SIGTERM`, the app stops accepting requests, finishes or times out in-flight settlements, and exits cleanly.

---

### 124. Contributor documentation and GitHub templates

**Labels:** `docs` `good first issue` · **Priority:** P3 · **Difficulty:** Easy

**Description**
The repository has no `CONTRIBUTING.md`, code of conduct, issue templates, PR template or license. The license is `UNLICENSED` in `package.json`. New contributors don't know the branch naming, commit style, how to run the Stellar mode locally, or what "done" means.

**Tasks**
- [ ] Add `CONTRIBUTING.md` covering setup, the mock vs stellar modes, testing, commit conventions and migration rules.
- [ ] Add `.github/ISSUE_TEMPLATE/` (bug, feature) and `.github/pull_request_template.md` with a checklist (tests, migration, docs).
- [ ] Add `CODE_OF_CONDUCT.md`.
- [ ] Decide on a license, and update `package.json`.

**Acceptance criteria**
- [ ] A new contributor can go from clone to a merged PR by following the docs alone.

---

### 125. Prometheus metrics for the API, settlement and the RPC

**Labels:** `devops` `observability` `stellar` · **Priority:** P3 · **Difficulty:** Medium

**Description**
`docs/DATABASE_MONITORING.md` covers Postgres metrics, but the application itself exposes none: no request latency, no wager state counts, no RPC error rate. Operators cannot see a wager backlog building up in `SETTLING`.

**Tasks**
- [ ] Add `prom-client` (or `@willsoto/nestjs-prometheus`) with `GET /metrics`, protected by IP allow-list or basic auth.
- [ ] Add HTTP request histograms by route and status.
- [ ] Add gauges for the number of wagers in each status, and counters for settlements by outcome.
- [ ] Add a histogram for RPC call latency and errors by method.
- [ ] Add an example Grafana dashboard JSON to `docs/`.

**Acceptance criteria**
- [ ] `/metrics` exposes HTTP, wager and RPC metrics.
- [ ] A sample dashboard shows the settlement backlog.
