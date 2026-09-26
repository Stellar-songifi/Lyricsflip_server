#!/usr/bin/env bash
# Fails if a TypeORM migration exists outside src/migrations. typeorm.config.ts
# loads migrations from that directory only, so one anywhere else never runs.
set -euo pipefail

stray=$(
  {
    git ls-files --cached --others --exclude-standard -- '*.ts' '*.js' |
      grep -E '(^|/)[0-9]{13}-[^/]+$' || true
    git grep --untracked -l 'implements MigrationInterface' -- '*.ts' '*.js' || true
  } | grep -v '^src/migrations/' | sort -u || true
)

if [ -n "$stray" ]; then
  echo "Migrations must live in src/migrations. Move or delete:" >&2
  echo "$stray" >&2
  exit 1
fi
