# Security checks on pull requests

Every pull request is scanned for malware and supply-chain attacks before it can be merged. This page explains what runs, what each finding means, and the repository settings that make the checks binding.

The checks were added after the Drips Wave team warned maintainers about the **PolinRider** campaign. It spreads through contributors' machines and hides code in fake font files, a `dist/setup.js` started by a `preinstall` script, VS Code tasks that run when a folder is opened, and code appended to config files after long runs of whitespace. A full scan of this repository on 2026-11-18 (every commit on `main`, every blob ever stored, and all 131 pull-request branches) found **no indicators of this campaign**.

## What runs

| Workflow | Job | Blocks a PR when |
| --- | --- | --- |
| `security.yml` | **Malware & supply-chain scan** | Any blocking rule below matches in *any commit* of the PR, not just the final diff |
| `security.yml` | **Dependency review** | A changed dependency matches a GitHub advisory of moderate severity or higher, including advisories classified as **malware** |
| `security.yml` | **npm registry signatures & provenance** | Any installed package fails `npm audit signatures` (tampered or unsigned tarball). Installs with `--ignore-scripts`, so nothing runs |
| `security.yml` | **Secret scan** | TruffleHog finds a verified or unverifiable credential in the PR's commits |
| `codeql.yml` | **CodeQL** (TypeScript and workflow files) | Code scanning reports a security alert (`security-extended` queries) |

`security.yml` also runs a **full scan every Monday** and on every push to `main`. It covers every tracked file, every blob and path in history, and the head of every open PR, because this campaign can rewrite history and lives in contributors' branches.

### Why the scan is safe to run on untrusted code

- It uses the `pull_request` trigger, never `pull_request_target`. Fork PRs get a read-only token and no secrets.
- The scanner (`scripts/security/pr-malware-scan.mjs`) has no dependencies and only reads git objects. It never installs, imports or executes anything from the PR.
- The scanner and its allowlist are checked out from the **base branch**. A PR that edits the scanner cannot change the verdict on itself. The edit takes effect only after a maintainer has reviewed and merged it.
- Every third-party Action is pinned to a full commit SHA. Dependabot proposes updates.

## Scanner rules

**Blocking:**

| Rule | Catches |
| --- | --- |
| `known-marker`, `ioc-path` | Published PolinRider code markers, `fa-solid-*.woff2/.eot/.llf`, `dist/setup.js`, `temp_auto_push.bat`, `config.bat` |
| `vscode-config`, `vscode-autorun` | Committed `.vscode/tasks.json` or `settings.json`, `"runOn": "folderOpen"`, `task.allowAutomaticTasks` |
| `lifecycle-script`, `suspicious-script` | New or changed `preinstall`, `install`, `postinstall`, `prepare` (and other `pre`/`post` hooks), or scripts that download, decode, pipe to a shell, or run `dist/` from a lifecycle hook |
| `malicious-package`, `non-registry-dependency` | Known malicious packages, and dependencies from git, GitHub, URLs or local paths |
| `lockfile-registry`, `lockfile-integrity`, `lockfile-integrity-changed`, `install-script-package` | Tarballs from any registry other than `registry.npmjs.org`, missing or silently changed integrity hashes, and new packages that run install scripts |
| `npmrc-registry`, `npmrc-scripts`, `npmrc-token` | `.npmrc` or Yarn/pnpm config that redirects the registry, re-enables scripts or carries tokens |
| `code-after-blank-run`, `hidden-after-whitespace`, `trailing-hidden-code`, `very-long-line` | Code appended after many blank lines or pushed off-screen by whitespace, and minified or packed lines over 1,000 characters |
| `trojan-source` | Invisible or bidirectional Unicode characters that make code read differently from how it runs |
| `js-obfuscator`, `hex-escape-chain`, `unicode-escape-chain`, `charcode-payload`, `dynamic-eval` | Obfuscated or encoded payloads and `eval` / `new Function` |
| `pipe-to-shell`, `powershell-loader` | Download-and-execute one-liners |
| `exfil-endpoint`, `wallet-stealer`, `env-dump` | Paste sites, tunnels and webhooks used for exfiltration; browser-wallet extension and credential file paths; dumping `process.env` |
| `blocked-file-type`, `build-output-committed`, `symlink` | Executables, Windows scripts, fonts, archives, native modules, committed `dist/` or `node_modules/`, and symlinks |
| `workflow-privileged-trigger`, `workflow-injection` | Workflows using `pull_request_target` or `workflow_run`, or interpolating PR titles or bodies into scripts |

**For the reviewer (warnings, not blocking):** changes to sensitive paths (CI, Docker, configs, `package.json`, `scripts/`), new dependencies (check them for typosquatting), binary or large files, base64 decoding, process spawning, raw-IP URLs, unpinned Actions, workflows that read secrets, and back-dated commits (author date weeks before the commit date, a history-rewrite trick).

The findings appear as annotations on the PR's **Files changed** tab, and as a table in the job summary.

## When a check fails

1. **Assume it is real until proven otherwise.** Do not re-run it hoping for green, and do not merge around it.
2. Open the job summary and read each blocking finding. Look at the exact commit and line, including commits the final diff no longer shows.
3. **If it is malware:** do not check out or install the branch on your own machine. Close the PR, report the account to GitHub, ask the contributor to follow the cleanup steps (secure any wallets, rotate every token and key from a clean device, reinstall the OS), and run the full scan (`Actions → Security → Run workflow`).
4. **If it is a legitimate change** (for example a new dependency that really needs an install script): add the narrowest possible entry to `scripts/security/allowlist.json` in a **separate** PR that explains why. CODEOWNERS requires a maintainer to approve it, and the original PR passes once that is merged.
5. **Lockfile from another registry** (`lockfile-registry`): the contributor's npm is configured to use a mirror. Ask them to run `npm config get registry`, switch back to `https://registry.npmjs.org/`, and regenerate the lockfile.

Run the scanner locally (it only reads git, so this is safe):

```bash
node scripts/security/pr-malware-scan.mjs --repo . --base origin/main --head HEAD   # your branch
node scripts/security/pr-malware-scan.mjs --repo . --full                          # everything
node --test scripts/security/pr-malware-scan.test.mjs                               # scanner self-test
```

## Repository settings that make this binding

Workflows only *report*. A maintainer with admin access must turn these on in **Settings**:

1. **Branches → Branch protection rule (or Ruleset) for `main`:**
   - Require a pull request before merging, with **1 approval**, **Require review from Code Owners**, and **Dismiss stale approvals when new commits are pushed** (so a malicious commit cannot ride on an earlier approval).
   - Require status checks to pass, and require branches to be up to date. Select: *Malware & supply-chain scan*, *Dependency review*, *npm registry signatures & provenance*, *Secret scan*, *CodeQL (javascript-typescript)*, *CodeQL (actions)*, and the CI jobs.
   - **Require signed commits.**
   - Block force pushes and deletions, and do not allow bypassing the rules.
2. **Code security:** enable the dependency graph, Dependabot alerts and security updates, **secret scanning with push protection**, and code scanning.
3. **Actions → General:** allow only GitHub-authored and verified actions (or actions pinned to a SHA); set the default workflow permissions to **read**; require approval for workflows from **all outside collaborators**.
4. Review **Collaborators**, **Deploy keys**, **Webhooks** and **GitHub Apps** for anything you do not recognize.

## Contributors: keep your machine clean

- Never open a repository you do not trust in VS Code with "Trust" enabled. Restricted mode does not run tasks.
- Check that `npm config get ignore-scripts` returns `true` when installing unfamiliar code, and that `npm config get registry` is `https://registry.npmjs.org/`.
- Never commit `.vscode/settings.json` or `.vscode/tasks.json` (they are in `.gitignore`).
- If you find any indicator on your machine, follow the incident steps above before pushing anything else.
