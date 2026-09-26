import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * `tokenVersion` is embedded in every access token's payload and checked on
 * each request. Bumping it (on password change, or a future "log out
 * everywhere") makes every access token issued before the bump fail
 * validation immediately, without needing a revocation list for JWTs.
 */
export class AddTokenVersionToUsers1759000000001
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'tokenVersion',
        type: 'int',
        default: 0,
        isNullable: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'tokenVersion');
  }
}
