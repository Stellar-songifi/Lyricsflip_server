# Contributing to LyricsFlip Server

Thank you for your interest in contributing! This guide covers everything you need to go from a fresh clone to an open pull request.

---

## Table of contents

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running the server](#running-the-server)
- [Mock mode vs Stellar mode](#mock-mode-vs-stellar-mode)
  - [Mock mode (default)](#mock-mode-default)
  - [Stellar mode (testnet)](#stellar-mode-testnet)
- [Testing](#testing)
- [Commit conventions](#commit-conventions)
- [Branch naming](#branch-naming)
- [Migration rules](#migration-rules)
- [Definition of done](#definition-of-done)
- [Opening a pull request](#opening-a-pull-request)

---

## Prerequisites

| Tool | Minimum version | Notes |
|---|---|---|
| Node.js | 20 | Use [nvm](https://github.com/nvm-sh/nvm) to manage versions |
| npm | 10 | Bundled with Node 20 |
| PostgreSQL | 14 | With the `uuid-ossp` extension available |
| Rust + Cargo | stable | Only needed for contract work; install via [rustup](https://rustup.rs) |
| Stellar CLI | latest | Only needed for contract deployment; `cargo install stellar-cli` |

---

## Setup

```bash
# 1. Fork and clone
git clone https://github.com/<your-username>/Lyricsflip_server.git
cd Lyricsflip_server

# 2. Install dependencies
npm install

# 3. Copy the example environment file and fill in the required values
cp .env.example .env
#   Edit .env: at minimum set DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD,
#   DB_NAME, and JWT_SECRET (must be at least 32 characters).

# 4. Create the database
createdb lyricflip

# 5. Apply migrations
npm run migration:run

# 6. (Optional) Seed sample data
npm run seed
```

---

## Running the server

```bash
npm run start:dev       # watch mode (recommended for development)
npm run start:debug     # watch mode with Node inspector
npm run build && npm run start:prod  # production build
```

The API listens on `PORT` (default `3000`). Swagger UI is available at **`/api/docs`**.

---

## Mock mode vs Stellar mode

The wager settlement backend is chosen at startup by the `STELLAR_SETTLEMENT_MODE` environment variable.

### Mock mode (default)

```env
STELLAR_SETTLEMENT_MODE=mock
```

- Balances live in the `users.mockBalance` Postgres column. Every new user starts with 100 LYRIC.
- No network calls are made. No Stellar keys are required.
- This is the default for local development, CI, and unit tests.

### Stellar mode (testnet)

```env
STELLAR_SETTLEMENT_MODE=stellar
STELLAR_NETWORK=testnet
STELLAR_ESCROW_CONTRACT_ID=C...   # deployed escrow contract
STELLAR_TOKEN_CONTRACT_ID=C...    # LYRIC token or SAC address
STELLAR_RESOLVER_SECRET=S...      # keypair that signs settlements
```

Steps to run Stellar mode locally against the testnet:

1. **Generate and fund accounts:**
   ```bash
   stellar keys generate resolver --network testnet --fund
   stellar keys generate admin    --network testnet --fund
   ```

2. **Build and deploy the contract** (from `contracts/`):
   ```bash
   cargo build --target wasm32-unknown-unknown --release
   stellar contract deploy \
     --wasm target/wasm32-unknown-unknown/release/lyricsflip_escrow.wasm \
     --source admin --network testnet
   ```

3. **Initialise the contract** (run immediately after deploy):
   ```bash
   stellar contract invoke --id <contract-id> --source admin --network testnet \
     -- initialize \
     --admin <admin-address> \
     --token <token-contract-id> \
     --resolver <resolver-address>
   ```

4. Set the three `STELLAR_*` variables in `.env` and restart the server.

> **Warning:** Never set `STELLAR_CUSTODY_MODE=custodial` together with `STELLAR_NETWORK=public`. The server refuses to start in this combination to prevent spending real player funds.

---

## Testing

```bash
# Unit tests (no database required)
npm test

# Unit tests with coverage
npm run test:cov

# End-to-end tests (requires a running Postgres database)
npm run test:e2e

# Rust / Soroban contract tests
cd contracts && cargo test
```

All 34 unit suites must pass before opening a PR. The CI pipeline runs lint, type-check, unit tests, and a build on every PR. E2E tests and a migration drift check run in a separate job with a real Postgres service container.

---

## Commit conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Every commit message must follow this format:

```
<type>(<optional scope>): <short description>

[optional body]

[optional footer(s)]
```

Common types:

| Type | When to use |
|---|---|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `chore` | Build process, dependency updates, tooling |
| `perf` | Performance improvement |

Examples:

```
feat(wagers): add reconciliation endpoint for stuck settlements
fix(auth): reject deactivated users even with a valid token
docs: add migration guide for read-replica setup
```

Keep the subject line under 72 characters. Use the body to explain *why*, not *what*.

---

## Branch naming

| Type | Pattern | Example |
|---|---|---|
| New feature | `feat/<short-description>` | `feat/prometheus-metrics` |
| Bug fix | `fix/<short-description>` | `fix/wager-reconcile-refund` |
| Documentation | `docs/<short-description>` | `docs/contributor-guide` |
| Refactor | `refactor/<short-description>` | `refactor/rpc-service-metrics` |
| Chore | `chore/<short-description>` | `chore/upgrade-stellar-sdk` |

**Never push directly to `main`.**

---

## Migration rules

Any change to a TypeORM entity **must** be accompanied by a migration.

```bash
# Generate a migration from your entity changes (name it descriptively)
npm run migration:generate -- src/migrations/AddXpToUsers

# Apply pending migrations
npm run migration:run

# Roll back the last migration (useful during development)
npm run migration:revert

# Verify no drift between entities and database (runs in CI)
npm run migration:check
```

Rules:
- **Never edit an already-applied migration.** Create a new one instead.
- Migration files live in `src/migrations/`. The CI pipeline (`migrations.yml`) refuses to merge if `migration:check` finds a drift.
- Test your migration on a clean database (`npm run migration:run` from scratch) before opening a PR.

---

## Definition of done

A contribution is ready to merge when all of the following are true:

- [ ] All unit tests pass (`npm test`).
- [ ] Lint passes with no errors (`npm run lint:check`).
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`).
- [ ] A migration is included if any entity was changed.
- [ ] Relevant documentation (README, docs/) is updated.
- [ ] No secrets, credentials, or `.env` files are committed.
- [ ] All acceptance criteria listed on the linked issue are met.

---

## Opening a pull request

1. Pick an issue from [`ISSUES.md`](ISSUES.md). Issues labelled `good first issue` are self-contained and well-scoped.
2. Create a branch following the [naming convention](#branch-naming) above.
3. Implement the change and make sure every item in the [Definition of done](#definition-of-done) is checked.
4. Open a PR against `main` on the upstream repository (`Stellar-songifi/Lyricsflip_server`).
5. Fill in the pull request template. Link the issue with `Closes #<number>`.
6. Respond to review feedback promptly. The maintainers aim to review PRs within a few days.

Thank you for contributing!
