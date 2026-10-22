import { MigrationInterface, QueryRunner } from 'typeorm';

interface OneTimeTokenTable {
  table: string;
  /** UNIQUE constraint on tokenHash added by createTable, dropped here. */
  unique: string;
  /** [hand-written name, TypeORM-derived name] */
  userIdIndex: [string, string];
  tokenHashIndex: [string, string];
}

const ONE_TIME_TOKEN_TABLES: OneTimeTokenTable[] = [
  {
    table: 'email_tokens',
    unique: 'UQ_3c9d0517a29ae032a37e258d517',
    userIdIndex: ['IDX_email_tokens_userId', 'IDX_0a5e6c81093655b770eabd0460'],
    tokenHashIndex: [
      'IDX_email_tokens_tokenHash',
      'IDX_3c9d0517a29ae032a37e258d51',
    ],
  },
  {
    table: 'password_reset_tokens',
    unique: 'UQ_1143abb8c3fad8b06dd857a8c9c',
    userIdIndex: [
      'IDX_password_reset_tokens_userId',
      'IDX_d6a19d4b4f6c62dcd29daa497e',
    ],
    tokenHashIndex: [
      'IDX_password_reset_tokens_tokenHash',
      'IDX_1143abb8c3fad8b06dd857a8c9',
    ],
  },
];

/**
 * Brings `refresh_tokens`, `email_tokens` and `password_reset_tokens` in line
 * with their entities (issues R2-7 and R2-8):
 *
 * - timestamps become `timestamptz`, as the entities declare. Existing values
 *   were written by node-postgres in the server's local time; the
 *   conversion reads them as UTC, which is what the Docker image runs in;
 * - hand-named indexes and foreign keys get the names TypeORM derives;
 * - `email_tokens` and `password_reset_tokens` drop the extra UNIQUE
 *   constraint on `tokenHash` (the unique index the entity declares stays);
 * - `email_tokens.purpose` uses the value the code writes and queries,
 *   `verify_email`, instead of `email_verification`; existing rows are
 *   rewritten so outstanding verification links keep working.
 *
 * Every step is guarded, so tables created by `synchronize` (which already
 * have the derived names and types) are left as they are.
 */
export class AlignAuthTokenTables1794000000003 implements MigrationInterface {
  name = 'AlignAuthTokenTables1794000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- refresh_tokens ----
    await this.renameIndex(
      queryRunner,
      'IDX_refresh_tokens_token_hash',
      'IDX_c25bc63d248ca90e8dcc1d92d0',
    );
    await this.renameIndex(
      queryRunner,
      'IDX_refresh_tokens_user_id',
      'IDX_610102b60fea1455310ccd299d',
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_c25bc63d248ca90e8dcc1d92d0" ON "refresh_tokens" ("tokenHash") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_610102b60fea1455310ccd299d" ON "refresh_tokens" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT IF EXISTS "FK_refresh_tokens_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT IF EXISTS "FK_610102b60fea1455310ccd299de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_610102b60fea1455310ccd299de" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    for (const column of ['expiresAt', 'revokedAt', 'createdAt']) {
      await this.toTimestamptz(queryRunner, 'refresh_tokens', column);
    }

    // ---- email_tokens and password_reset_tokens ----
    await queryRunner.query(
      `UPDATE "email_tokens" SET "purpose" = 'verify_email' WHERE "purpose" = 'email_verification'`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_tokens" ALTER COLUMN "purpose" SET DEFAULT 'verify_email'`,
    );
    for (const names of ONE_TIME_TOKEN_TABLES) {
      await this.alignOneTimeTokenTable(queryRunner, names);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const names of [...ONE_TIME_TOKEN_TABLES].reverse()) {
      const { table } = names;
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP`,
      );
      for (const column of ['expiresAt', 'usedAt', 'createdAt']) {
        await this.toTimestamp(queryRunner, table, column);
      }
      await this.renameIndex(
        queryRunner,
        names.tokenHashIndex[1],
        names.tokenHashIndex[0],
      );
      await this.renameIndex(
        queryRunner,
        names.userIdIndex[1],
        names.userIdIndex[0],
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${names.unique}" UNIQUE ("tokenHash")`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "email_tokens" ALTER COLUMN "purpose" SET DEFAULT 'email_verification'`,
    );
    await queryRunner.query(
      `UPDATE "email_tokens" SET "purpose" = 'email_verification' WHERE "purpose" = 'verify_email'`,
    );

    for (const column of ['expiresAt', 'revokedAt', 'createdAt']) {
      await this.toTimestamp(queryRunner, 'refresh_tokens', column);
    }
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_610102b60fea1455310ccd299de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_refresh_tokens_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await this.renameIndex(
      queryRunner,
      'IDX_610102b60fea1455310ccd299d',
      'IDX_refresh_tokens_user_id',
    );
    await this.renameIndex(
      queryRunner,
      'IDX_c25bc63d248ca90e8dcc1d92d0',
      'IDX_refresh_tokens_token_hash',
    );
  }

  private async alignOneTimeTokenTable(
    queryRunner: QueryRunner,
    names: OneTimeTokenTable,
  ): Promise<void> {
    const { table } = names;
    await this.renameIndex(
      queryRunner,
      names.userIdIndex[0],
      names.userIdIndex[1],
    );
    await this.renameIndex(
      queryRunner,
      names.tokenHashIndex[0],
      names.tokenHashIndex[1],
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "${names.userIdIndex[1]}" ON "${table}" ("userId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${names.tokenHashIndex[1]}" ON "${table}" ("tokenHash") `,
    );
    await queryRunner.query(
      `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${names.unique}"`,
    );
    for (const column of ['expiresAt', 'usedAt', 'createdAt']) {
      await this.toTimestamptz(queryRunner, table, column);
    }
    await queryRunner.query(
      `ALTER TABLE "${table}" ALTER COLUMN "createdAt" SET DEFAULT now()`,
    );
  }

  /** Renames an index when the old name exists and the new one does not. */
  private async renameIndex(
    queryRunner: QueryRunner,
    from: string,
    to: string,
  ): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public."${from}"') IS NOT NULL
          AND to_regclass('public."${to}"') IS NULL THEN
          ALTER INDEX "public"."${from}" RENAME TO "${to}";
        END IF;
      END $$
    `);
  }

  private async columnType(
    queryRunner: QueryRunner,
    table: string,
    column: string,
  ): Promise<string | undefined> {
    const rows: { data_type: string }[] = await queryRunner.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
      [table, column],
    );
    return rows[0]?.data_type;
  }

  private async toTimestamptz(
    queryRunner: QueryRunner,
    table: string,
    column: string,
  ): Promise<void> {
    if (
      (await this.columnType(queryRunner, table, column)) ===
      'timestamp without time zone'
    ) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE TIMESTAMP WITH TIME ZONE USING "${column}" AT TIME ZONE 'UTC'`,
      );
    }
  }

  private async toTimestamp(
    queryRunner: QueryRunner,
    table: string,
    column: string,
  ): Promise<void> {
    if (
      (await this.columnType(queryRunner, table, column)) ===
      'timestamp with time zone'
    ) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE TIMESTAMP USING "${column}" AT TIME ZONE 'UTC'`,
      );
    }
  }
}
