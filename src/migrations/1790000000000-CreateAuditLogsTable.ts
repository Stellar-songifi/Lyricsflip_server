import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditLogsTable1790000000000 implements MigrationInterface {
  name = 'CreateAuditLogsTable1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "actorId" character varying NOT NULL,
        "action" character varying NOT NULL,
        "targetType" character varying,
        "targetId" character varying,
        "payload" jsonb,
        "ip" character varying,
        "timestamp" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_actor_id" ON "audit_logs" ("actorId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_action" ON "audit_logs" ("action")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_target_id" ON "audit_logs" ("targetId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_audit_logs_target_id"`);
    await queryRunner.query(`DROP INDEX "IDX_audit_logs_action"`);
    await queryRunner.query(`DROP INDEX "IDX_audit_logs_actor_id"`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
  }
}
