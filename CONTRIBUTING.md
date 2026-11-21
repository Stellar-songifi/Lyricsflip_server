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
- [Git hooks (husky + lint-staged)](#git-hooks-husky--lint-staged)
- [Commit conventions](#commit-conventions)
- [Branch naming](#branch-naming)
- [Migration rules](#migration-rules)
- [Definition of done](#definition-of-done)
- [Opening a pull request](#opening-a-pull-request)
- [Staying inside your issue's scope](#staying-inside-your-issues-scope)
- [Closing an issue](#closing-an-issue)

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

`npm test` must be green before opening a PR — every unit suite has to pass. The CI pipeline runs lint, type-check, unit tests, and a build on every PR. E2E tests and a migration drift check run in a separate job with a real Postgres service container.

---

## Required checks and merge process

`main` is protected. Nothing merges red — the GitHub UI refuses to merge a pull request while any required check is failing or still running.

The following checks are **required** on every PR to `main`:

| Check | What it covers |
|---|---|
| `lint-typecheck-test-build` | ESLint, `tsc --noEmit`, unit tests, and the production build |
| `docker-build` | Builds the Docker image and smoke-starts the app |
| `e2e` | End-to-end tests against a real Postgres service container |
| `contract` | Builds and tests the Soroban contract in `contracts/` |

Additional rules enforced by branch protection:

- **Branches must be up to date with `main`** before merging. Rebase or merge `main` into your branch and wait for CI to re-run.
- **Force pushes to `main` are blocked.** Never push directly to `main`; all changes go through a pull request.
- **A merge queue is enabled.** PRs are merged through the queue, which re-runs the required checks against the latest `main` plus the queued PRs. This guarantees that two individually green PRs cannot combine into a red `main`.
- **CODEOWNERS review is required** for anything touching `src/tokens/`, `src/stellar/`, `src/auth/` or `contracts/`. At least one approving review from a maintainer is needed before such a PR can merge.
=======

---

## Git hooks (husky + lint-staged)

`npm install` installs [husky](https://typicode.github.io/husky/) hooks automatically (via the `prepare` script). They catch problems before they reach CI:

| Hook | What runs | Why |
|---|---|---|
| `pre-commit` | `lint-staged` → `eslint --fix` and `prettier --check` on staged `.ts` files | Refuses a commit that does not parse or does not match formatting |
| `pre-push` | `tsc --noEmit -p tsconfig.json` | Refuses a push that does not type-check |

If a hook fails, fix the reported file and stage it again. Do not work around a failing hook by disabling it.

### Bypassing a hook in an emergency

Sometimes you need to commit or push while a hook is broken (for example, a hook itself is failing on an unrelated file). You can skip the hooks:

```bash
# Skip pre-commit and commit-msg hooks for a single commit
git commit --no-verify -m "fix(auth): ..."

# Skip the pre-push hook for a single push
git push --no-verify

# Or disable husky entirely for one command
HUSKY=0 git commit -m "fix(auth): ..."
```

**CI is still the backstop.** Skipping a hook only skips the local check — the same lint, type-check, and test jobs run on every PR and will fail there. If you bypass a hook, mention it in the PR description so reviewers know to look closely.

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

## TypeScript strict mode

`tsconfig.json` enables `"strict": true`. Two conventions keep the codebase compiling under it:

- **Entities and DTOs use definite-assignment assertions.** TypeORM entities and class-validator DTOs declare properties that are populated by the ORM or by validation, not by a constructor, so every such property is marked with `!`:

  ```ts
  @Entity('users')
  export class User {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column()
    email!: string;
  }
  ```

  We deliberately keep `strictPropertyInitialization` on rather than disabling it, so that ordinary classes still get the check. **New entities and DTOs must follow the same convention** — do not add initializers just to silence the compiler, and do not turn off individual strict flags.

- **`unknown` errors are narrowed, never cast.** In `catch` blocks and error callbacks, narrow with a type guard before use:

  ```ts
  function isError(value: unknown): value is Error {
    return value instanceof Error;
  }

  try {
    await this.doWork();
  } catch (error: unknown) {
    const message = isError(error) ? error.message : String(error);
    this.logger.error(message);
  }
  ```

  Casting to `any` (or `as Error`) to get past `TS18046` is not acceptable; fix the narrowing instead. Implicit `any` (`TS7006`) must be given an explicit type.

---

## Migration rules
=======

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
- [ ] Relevant documentation (README, docs/) is updated — required for any change to routes, environment variables, or runtime behavior.
- [ ] "Docs updated?" checkbox in the pull request template is completed.
- [ ] No secrets, credentials, or `.env` files are committed.
- [ ] All acceptance criteria listed on the linked issue are met.
- [ ] Every changed file is listed in the **Files** section of the linked issue, or its inclusion is justified in the PR template.
- [ ] No public method, route, or exported symbol was removed without being called out in the PR description.

---

## Opening a pull request

1. Pick an issue from [`ISSUES.md`](ISSUES.md). Issues labelled `good first issue` are self-contained and well-scoped.
2. Create a branch following the [naming convention](#branch-naming) above.
3. Implement the change and make sure every item in the [Definition of done](#definition-of-done) is checked.
4. Open a PR against `main` on the upstream repository (`Stellar-songifi/Lyricsflip_server`).
5. Fill in the pull request template. Link the issue with `Closes #<number>`.
6. Respond to review feedback promptly. The maintainers aim to review PRs within a few days.

---

## Staying inside your issue's scope

Every issue lists the files it expects to touch under **Files**. A pull request must stay inside that list.

- If you need to change a file that is **not** in the issue's list, add it to the **"Files outside the issue's list and why"** section of the pull request template and explain the reason. A CI job warns when a PR changes more than a handful of lines in a file its linked issue does not name.
- Do not remove or rename a public method, route, or exported symbol as a side effect of an unrelated change. The PR template has a checkbox confirming this; if you must remove one, say so explicitly in the description.
- If the scope of the issue is genuinely too small, comment on the issue first and get agreement before expanding it.

Keeping PRs scoped makes review faster and prevents one issue's fix from silently undoing another's.

---

## Closing an issue

When you close an issue, leave evidence that it is actually fixed on `main`:

- Add a comment with the commit SHA that fixed it, or link the PR that did.
- Tick the **"Verified on main at `<sha>`"** checkbox in the issue's acceptance criteria, replacing `<sha>` with the commit you verified against.
- If the fix was later undone, reopen the issue and link the follow-up issue that supersedes it.

An issue is only done when someone can point at the commit on `main` that makes its acceptance criteria true.

### Security checks

Every PR is scanned for malware and supply-chain attacks: hidden or obfuscated code, install scripts, fake font or binary files, VS Code auto-run tasks, lockfiles that point at registries other than `registry.npmjs.org`, known malicious packages, leaked secrets, and CodeQL alerts. A blocking finding cannot be merged around. See [`docs/SECURITY_CHECKS.md`](docs/SECURITY_CHECKS.md) for what each rule means and how to fix a false positive. You can run the same scan locally before pushing:

```bash
node scripts/security/pr-malware-scan.mjs --repo . --base origin/main --head HEAD
```

Never commit `.vscode/settings.json` or `.vscode/tasks.json`, never add install or `prepare` scripts without discussing it first, and keep your npm registry set to the default. Changes to CI, dependencies, configs and Docker files need a maintainer's approval (CODEOWNERS). To report suspected malware privately, see [`SECURITY.md`](SECURITY.md).

Thank you for contributing!
