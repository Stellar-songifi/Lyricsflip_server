#!/bin/sh
# Container entrypoint for the API image.
#
# 1. With RUN_MIGRATIONS=true, applies pending TypeORM migrations using the
#    compiled data source (dist/typeorm.config.js) before the app starts.
# 2. Runs the command. The default CMD, "node-main", starts the compiled app.
#    tsconfig.json compiles typeorm.config.ts alongside src/, so tsc emits
#    the app under dist/src/; dist/main.js is checked too in case that changes.
set -e

if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "Running database migrations..."
  node node_modules/typeorm/cli.js migration:run -d dist/typeorm.config.js
fi

if [ "$1" = "node-main" ]; then
  if [ -f dist/src/main.js ]; then
    exec node dist/src/main.js
  fi
  exec node dist/main.js
fi

exec "$@"
