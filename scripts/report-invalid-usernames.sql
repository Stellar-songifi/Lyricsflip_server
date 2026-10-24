-- Lists existing usernames that break the username rule (issue R2-90).
--
-- Read-only. Run it against a database before deciding how to handle the
-- accounts it lists (ask the user to rename, or rename them by hand):
--
--   psql "$DATABASE_URL" -f scripts/report-invalid-usernames.sql
--
-- The rule lives in src/common/validators/username.validator.ts
-- (USERNAME_RULE, RESERVED_USERNAMES, RESERVED_USERNAME_PREFIXES). Keep the
-- pattern and the reserved list below in step with it.
--
-- Anonymised accounts (deleted_<uuid>, set by UsersService.remove) are
-- expected to break the rule and are left out.

SELECT
  id,
  username,
  CASE
    WHEN username !~ '^[a-zA-Z][a-zA-Z0-9_]{2,19}$' THEN 'breaks pattern'
    ELSE 'reserved name'
  END AS problem,
  "createdAt"
FROM users
WHERE NOT (LOWER(username) LIKE 'deleted\_%' AND "isActive" = false)
  AND (
    username !~ '^[a-zA-Z][a-zA-Z0-9_]{2,19}$'
    OR LOWER(username) IN (
      'admin', 'administrator', 'me', 'root', 'support',
      'system', 'moderator', 'lyricsflip'
    )
    OR LOWER(username) LIKE 'deleted\_%'
  )
ORDER BY "createdAt";
