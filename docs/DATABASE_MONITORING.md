Database Monitoring with Prometheus & Grafana
This document outlines a strategy for setting up comprehensive monitoring for a PostgreSQL database using industry-standard open-source tools.

1. The Tools
   Prometheus: An open-source monitoring system that scrapes (pulls) metrics from configured endpoints at specified intervals, evaluates rule expressions, and can trigger alerts if certain conditions are met.

Grafana: An open-source platform for monitoring and observability that allows you to query, visualize, alert on, and explore your metrics no matter where they are stored. It's famous for creating beautiful and useful dashboards.

Postgres Exporter: A small "sidecar" application that connects to your PostgreSQL database, collects a wide range of metrics, and exposes them in a format that Prometheus can understand.

2. The Architecture
   The monitoring setup works as follows:

Postgres Exporter runs alongside your PostgreSQL database. It queries internal PostgreSQL statistics tables (like pg_stat_database) and exposes them on an HTTP endpoint (e.g., http://<your-server-ip>:9187/metrics).

Prometheus is configured to periodically "scrape" this endpoint, collecting and storing all the metrics over time.

Grafana is configured with Prometheus as a "data source." You can then build dashboards in Grafana by creating panels that query the metrics stored in Prometheus.

3. Implementation Steps
   Set up Postgres Exporter: Deploy the Postgres Exporter on the same server as your database or on a server that has network access to it. You will need to provide it with a database connection string.

Install and Configure Prometheus: Set up a Prometheus server. In its configuration file (prometheus.yml), add a "scrape config" to tell it where to find the Postgres Exporter's metrics endpoint.

Install and Configure Grafana: Set up a Grafana server. Add your Prometheus instance as a data source.

Import a Dashboard: The Grafana community provides many pre-built dashboards. You can import a popular PostgreSQL dashboard (like this one) and it will automatically populate with data from your Prometheus source, giving you instant visibility into your database's health.

This setup provides a powerful, real-time dashboard for monitoring database performance and health, which is crucial for maintaining a reliable production application.

---

## TypeORM Query Logging and Connection Pool Configuration

The following environment variables control how TypeORM logs SQL and manages
the connection pool.  Set them in `.env` or your deployment config.

| Variable | Default | Description |
|---|---|---|
| `DB_LOGGING` | `error` (prod) / `error,warn,slow` (dev) | Comma-separated TypeORM log levels, or `all` to log every query, or `false` to disable logging entirely. Accepted levels: `query`, `error`, `schema`, `warn`, `info`, `log`, `slow`. |
| `DB_POOL_SIZE` | `10` | Maximum number of simultaneous connections in the pg pool. Increase for high-concurrency workloads; keep low for serverless deployments where connections are expensive. |
| `DB_SLOW_QUERY_THRESHOLD_MS` | `250` | TypeORM emits a `slow` log entry for any query that takes longer than this many milliseconds.  Slow-query entries are included when `DB_LOGGING` contains `slow`. |

### Recommended production settings

```dotenv
DB_LOGGING=error,slow          # only errors and slow queries
DB_POOL_SIZE=20                # tune to (max_connections / num_pods) − headroom
DB_SLOW_QUERY_THRESHOLD_MS=500 # flag queries over 500 ms
```

Logging all queries (`DB_LOGGING=all` or `DB_LOGGING=query`) in production is
**strongly discouraged**: it is noisy, degrades performance, and can leak
parameter values (including tokens or hashed passwords that happen to appear in
a query) into your log aggregator.

### Slow query monitoring

When a query exceeds `DB_SLOW_QUERY_THRESHOLD_MS`, TypeORM writes a warning
that includes the SQL text and the actual duration.  Feed these into your log
aggregator and alert on them — a sudden increase in slow queries is usually the
first sign of a missing index or lock contention.

