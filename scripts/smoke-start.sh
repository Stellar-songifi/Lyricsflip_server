#!/usr/bin/env bash
# Smoke test for the compiled build (#355): start `node dist/main.js` and
# check it gets past module loading and config validation.
#
# Passes when the app reports "Application is running", or when the only
# failure is reaching the database (no database is provided here). Fails on
# anything else, in particular "Cannot find module" from a bare src/... import.
#
# Usage: npm run build && bash scripts/smoke-start.sh
set -uo pipefail

if [ ! -f dist/main.js ]; then
  echo "dist/main.js not found; run npm run build first" >&2
  exit 1
fi

log="$(mktemp)"
NODE_ENV=test \
PORT="${SMOKE_PORT:-3999}" \
HOST=127.0.0.1 \
LOG_LEVEL=info \
JWT_SECRET="smoke-test-secret-that-is-at-least-32-characters" \
DB_HOST=127.0.0.1 \
DB_PORT="${SMOKE_DB_PORT:-1}" \
DB_USERNAME=smoke \
DB_PASSWORD=smoke \
DB_NAME=smoke \
  node dist/main.js >"$log" 2>&1 &
pid=$!

result=""
for _ in $(seq 1 90); do
  if grep -q "Cannot find module" "$log"; then result="fail"; break; fi
  if grep -q "Config validation error" "$log"; then result="fail"; break; fi
  if grep -q "Application is running" "$log"; then result="pass"; break; fi
  if grep -Eq "Unable to connect to the database|ECONNREFUSED" "$log"; then result="pass"; break; fi
  if ! kill -0 "$pid" 2>/dev/null; then result="fail"; break; fi
  sleep 1
done

kill "$pid" 2>/dev/null
wait "$pid" 2>/dev/null

if [ "$result" = "pass" ]; then
  echo "smoke-start: the compiled app loads (stopped at: $(grep -Eo 'Application is running|Unable to connect to the database|ECONNREFUSED' "$log" | head -1))"
  exit 0
fi
echo "smoke-start: the compiled app failed to start${result:+ ($result)}" >&2
tail -n 40 "$log" >&2
exit 1
