# Data Archiving Strategy

This document outlines the retention and archiving strategy for high-volume historical data in the Lyricsflip PostgreSQL database.

## 1. Objectives

- Maintain low query latency on high-frequency tables (`game_rounds`, `game_sessions`, `wagers`).
- Reduce primary database storage growth and backup snapshot sizes.
- Preserve audit and analytical records for compliance, dispute resolution, and reporting.

## 2. Table-Specific Retention Policies

| Table | Retention in Primary DB | Archive Policy |
|---|---|---|
| `game_rounds` | 90 days after session completion | Export to cold object storage (Parquet/CSV on S3/GCS); purge completed rounds older than 90 days. |
| `game_sessions` | 180 days after completion or abandonment | Archive completed/abandoned sessions with no open wagers. |
| `wagers` | 365 days after terminal state (`SETTLED`, `REFUNDED`, `FAILED`) | Retain financial records on-chain and in archival cold storage for tax/compliance purposes. |
| `audit_logs` | 180 days in primary database | Stream to cold storage or log aggregator (e.g. OpenSearch / BigQuery) for long-term retention. |
| `refresh_tokens` | Until expiry, or 30 days after revocation | `SessionCleanupJob` deletes them daily (see Personal data retention below). |

## 3. Recommended Archive & Purge Procedure

A monthly or weekly maintenance script executes:

```sql
-- 1. Export rounds from completed sessions older than 90 days
COPY (
  SELECT r.* FROM game_rounds r
  JOIN game_sessions s ON r."sessionId" = s.id
  WHERE s.status IN ('COMPLETED', 'ABANDONED')
    AND s."updatedAt" < NOW() - INTERVAL '90 days'
) TO PROGRAM 'gzip > /archive/game_rounds_$(date +%Y%m%d).csv.gz' WITH CSV HEADER;

-- 2. Verify export checksum, then purge
DELETE FROM game_rounds
WHERE "sessionId" IN (
  SELECT id FROM game_sessions
  WHERE status IN ('COMPLETED', 'ABANDONED')
    AND "updatedAt" < NOW() - INTERVAL '90 days'
);
```

Purge from Production: Once the copy is verified, the script deletes the archived rows from the production database table.

3. Example Workflow (Archiving User Logs)
Let's say we want to archive user logs older than 2 years.

A scheduled script runs once a month.

SQL Query to select data:

SELECT * FROM user_logs WHERE created_at < NOW() - INTERVAL '2 years';

The script takes the result of this query and inserts it into an archived_user_logs table in a separate "archive" database.

After verifying the data integrity in the archive, it runs the delete command on the production database:

DELETE FROM user_logs WHERE created_at < NOW() - INTERVAL '2 years';

This process ensures the production user_logs table remains at a manageable size, directly contributing to sustained application performance.

4. Game Rounds Retention (`game_rounds`)

A row is inserted into `game_rounds` every time a lyric is served, including rounds the player never guessed. Without retention this table grows without bound and the seen-window query (`getRecentlySeenLyricIds`, which filters by `userId` and `issuedAt`) degrades. Two mechanisms keep it bounded:

Index: `GameRound` declares a composite index on `(userId, issuedAt)` so the seen-window query uses an index scan instead of a sequential scan.

Daily retention job: a scheduled job runs once per day and is guarded by the distributed lock from issue 43 so concurrent runs cannot overlap. Each run:

- Deletes unguessed rounds older than the seen window (they are no longer relevant to `getRecentlySeenLyricIds`).
- Moves guessed rounds older than the configured retention period (N days) into the archive table, or deletes them once `game_history` already holds the record.

Retention settings (seen window and N days) are configurable; `game_rounds` size is therefore bounded by those settings rather than by total traffic.
Always execute purges in bounded batches during off-peak hours to avoid prolonged table locks.

## 5. Personal data retention

GDPR and NDPR require a stated retention period for every store of personal data. This table is that statement; each period is enforced by the job named in the last column. Periods marked *configurable* can be changed with the environment variable shown.

| Store | Personal data it holds | Kept for | Why | Enforced by |
|---|---|---|---|---|
| `users` | Email, username, name, Stellar address, preferences | Life of the account. On deletion the row is anonymised (email, username, name, address cleared) and kept so foreign keys stay valid | Needed to provide the service | `UsersService.remove` |
| `refresh_tokens` | User agent, network (IP truncated to /24 or /48), device name, last use | Until expiry (30 days), or 30 days after revocation. Deleted with the account | Lets users see and revoke their sessions; revoked rows kept briefly to trace token reuse | `SessionCleanupJob` (daily 04:00); `UsersService.erasePersonalData` |
| `email_tokens`, `password_reset_tokens` | Hash of a one-time token | Until used or expired. Deleted with the account | Account verification and recovery | Existing token services; `UsersService.erasePersonalData` |
| `notifications` | Events about the user's games | Read notifications: 90 days. Deleted with the account | Shown in the app; no value once read and old | `NotificationsService.purgeOldNotifications` (daily 03:00); `UsersService.erasePersonalData` |
| `audit_logs` | Actor id, action, sanitised request, IP address | Rows: kept (see section 2 for archiving). IP: 90 days, *configurable* `AUDIT_IP_RETENTION_DAYS`. IP cleared on account deletion | Audit trail for admin and settlement actions, used to resolve disputes; the IP is only needed while an incident is fresh | `RetentionJob` (daily 05:00); `UsersService.erasePersonalData` |
| `game_rounds` | Lyrics served to a player, timing | Unguessed: the seen window. Guessed: `roundRetentionDays` | Seen-window lyric selection and anti-cheat | `GameService.pruneGameRounds` (section 4) |
| `game_history` | Each guess, its value and result | 2 years in `game_history`, *configurable* `GAME_HISTORY_RETENTION_DAYS`; then moved to `game_history_archive`. Linked only by id after account deletion | Stats, leaderboards and dispute evidence | `RetentionJob` (daily 05:00) |
| `game_sessions`, `room_users`, `rooms` | Who played whom, scores, guesses in rooms | See section 2. Linked only by id after account deletion | Match records | Section 2 procedure |
| `wagers` | Stakes, payouts, transaction hashes, player ids | At least 365 days after settlement, then cold storage (section 2). Kept after account deletion | Financial record; the settlement is also on-chain | Section 2 procedure |
| Application logs (`LOG_TO_FILE=true`) | Request method, URL, IP address, user agent, user id | `logs/app-*.log`: 14 days. `logs/error-*.log`: 30 days | Debugging and incident response | winston daily rotation (`maxFiles`) |
| Application logs (stdout) | As above | Set by the hosting platform's log retention; configure it to 30 days or less | As above | Hosting platform |

### Account deletion

`DELETE /users/me` (and the admin delete) apply the table above to the user's other rows (in one transaction), then anonymise the `users` row:

- **Deleted:** refresh tokens, email and password-reset tokens, notifications.
- **IP cleared:** audit rows where the user is the actor. The rows themselves stay as the audit record.
- **Kept, linked only by id:** wagers (financial record), game history and its archive, sessions, rounds and room participation. Once the `users` row is anonymised these no longer identify the person.

