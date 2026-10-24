#!/bin/sh
# Container entrypoint for the LyricsFlip API (#352).
#
# 1. Waits until the database accepts TCP connections (DB_WAIT_TIMEOUT
#    seconds, default 60), so the API and migrations don't race Postgres.
# 2. When RUN_MIGRATIONS=true, applies pending migrations with the compiled
#    data source (dist/data-source.js). No ts-node is needed, so this works in
#    the production image, which has no dev dependencies.
# 3. Execs the container command, so the app is PID 1's direct child and
#    receives SIGTERM. The default CMD, "node-main", starts the compiled app
#    from dist/main.js, or dist/src/main.js if tsc nested the output.
set -eu

wait_for_database() {
  timeout="${DB_WAIT_TIMEOUT:-60}"
  node -e '
    const net = require("net");
    let host = process.env.DB_HOST;
    let port = Number(process.env.DB_PORT || 5432);
    if (process.env.DATABASE_URL) {
      const url = new URL(process.env.DATABASE_URL);
      host = url.hostname;
      port = Number(url.port || 5432);
    }
    if (!host) {
      console.log("[entrypoint] no DB_HOST or DATABASE_URL set; not waiting for the database");
      process.exit(0);
    }
    const deadline = Date.now() + Number(process.argv[1]) * 1000;
    const attempt = () => {
      const socket = net.connect({ host, port });
      socket.setTimeout(2000);
      socket.once("connect", () => {
        socket.end();
        console.log(`[entrypoint] database ${host}:${port} is accepting connections`);
        process.exit(0);
      });
      const retry = () => {
        socket.destroy();
        if (Date.now() > deadline) {
          console.error(`[entrypoint] database ${host}:${port} not reachable after ${process.argv[1]}s`);
          process.exit(1);
        }
        setTimeout(attempt, 1000);
      };
      socket.once("error", retry);
      socket.once("timeout", retry);
    };
    attempt();
  ' "$timeout"
}

wait_for_database

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "[entrypoint] running migrations"
  node node_modules/typeorm/cli.js migration:run -d dist/data-source.js
fi

if [ "${1:-}" = "node-main" ]; then
  if [ -f dist/main.js ]; then
    exec node dist/main.js
  fi
  exec node dist/src/main.js
fi

exec "$@"
