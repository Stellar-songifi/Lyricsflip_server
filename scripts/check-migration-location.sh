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

# TypeORM orders migrations by the 13-digit timestamp at the end of the class
# name. Two migrations sharing one run in an order that depends on file-system
# sorting, and the migrations table records them ambiguously (#358). The
# filename prefix must be unique too, and must match the class name.
migration_files=$(git ls-files --cached --others --exclude-standard -- 'src/migrations/*.ts' 'src/migrations/*.js')

dup_prefixes=$(
  printf '%s\n' "$migration_files" | sed -nE 's#^src/migrations/([0-9]{13})-.*#\1#p' | sort | uniq -d
)
dup_classes=$(
  printf '%s\n' "$migration_files" | xargs grep -hoE 'class [A-Za-z_]+[0-9]{13}' 2>/dev/null |
    grep -oE '[0-9]{13}$' | sort | uniq -d || true
)
if [ -n "$dup_prefixes$dup_classes" ]; then
  echo "Migration timestamps must be unique. Shared by more than one migration:" >&2
  printf '%s\n' $dup_prefixes $dup_classes | sort -u >&2
  exit 1
fi

mismatched=""
for file in $migration_files; do
  prefix=$(basename "$file" | grep -oE '^[0-9]{13}' || true)
  class_ts=$(grep -hoE 'class [A-Za-z_]+[0-9]{13}' "$file" | grep -oE '[0-9]{13}$' | head -n 1 || true)
  if [ -n "$prefix" ] && [ -n "$class_ts" ] && [ "$prefix" != "$class_ts" ]; then
    mismatched="$mismatched$file (class timestamp $class_ts)"$'\n'
  fi
done
if [ -n "$mismatched" ]; then
  echo "Migration filename prefix and class-name timestamp differ:" >&2
  printf '%s' "$mismatched" >&2
  exit 1
fi
