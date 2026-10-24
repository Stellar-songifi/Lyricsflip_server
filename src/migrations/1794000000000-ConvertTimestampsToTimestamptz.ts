import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Converts every `timestamp without time zone` column in the public schema to
 * `timestamptz`. Existing values were written as UTC wall-clock time, so they
 * are reinterpreted with `AT TIME ZONE 'UTC'`.
 */
export class ConvertTimestampsToTimestamptz1794000000000
  implements MigrationInterface
{
  name = 'ConvertTimestampsToTimestamptz1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.convert(queryRunner, 'timestamp without time zone', 'timestamptz');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.convert(queryRunner, 'timestamp with time zone', 'timestamp');
  }

  private async convert(
    queryRunner: QueryRunner,
    from: string,
    to: string,
  ): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE col record;
      BEGIN
        FOR col IN
          SELECT c.table_name, c.column_name
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema
           AND t.table_name = c.table_name
           AND t.table_type = 'BASE TABLE'
          WHERE c.table_schema = 'public'
            AND c.data_type = '${from}'
            AND c.table_name <> 'migrations'
        LOOP
          EXECUTE format(
            'ALTER TABLE %I ALTER COLUMN %I TYPE ${to} USING %I AT TIME ZONE ''UTC''',
            col.table_name, col.column_name, col.column_name
          );
        END LOOP;
      END $$;
    `);
  }
}
