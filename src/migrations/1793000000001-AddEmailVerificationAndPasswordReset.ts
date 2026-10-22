import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

/**
 * Was `AddEmailVerificationAndPasswordReset1793000000000`, which shared its
 * timestamp with AddDifficultyConstraintAndDefault. Renamed so the order is
 * unambiguous. Every step already checks whether its column or table exists,
 * so a database that ran it under the old name just records the new name.
 * AlignAuthTokenTables1794000000003 later brings these tables in line with
 * their entities. See docs/MIGRATIONS.md.
 */
export class AddEmailVerificationAndPasswordReset1793000000001
  implements MigrationInterface
{
  name = 'AddEmailVerificationAndPasswordReset1793000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add emailVerifiedAt column to users
    const usersTable = await queryRunner.getTable('users');
    if (usersTable && !usersTable.findColumnByName('emailVerifiedAt')) {
      await queryRunner.addColumn(
        'users',
        new TableColumn({
          name: 'emailVerifiedAt',
          type: 'timestamp',
          isNullable: true,
        }),
      );
    }

    // Create email_tokens table
    const emailTokensExists = await queryRunner.hasTable('email_tokens');
    if (!emailTokensExists) {
      await queryRunner.createTable(
        new Table({
          name: 'email_tokens',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              default: 'uuid_generate_v4()',
            },
            {
              name: 'userId',
              type: 'uuid',
              isNullable: false,
            },
            {
              name: 'purpose',
              type: 'varchar',
              length: '32',
              isNullable: false,
              default: "'email_verification'",
            },
            {
              name: 'tokenHash',
              type: 'varchar',
              length: '64',
              isNullable: false,
              isUnique: true,
            },
            {
              name: 'expiresAt',
              type: 'timestamp',
              isNullable: false,
            },
            {
              name: 'usedAt',
              type: 'timestamp',
              isNullable: true,
            },
            {
              name: 'createdAt',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
              isNullable: false,
            },
          ],
        }),
        true,
      );

      await queryRunner.createForeignKey(
        'email_tokens',
        new TableForeignKey({
          columnNames: ['userId'],
          referencedTableName: 'users',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );

      await queryRunner.createIndex(
        'email_tokens',
        new TableIndex({
          name: 'IDX_email_tokens_userId',
          columnNames: ['userId'],
        }),
      );

      await queryRunner.createIndex(
        'email_tokens',
        new TableIndex({
          name: 'IDX_email_tokens_tokenHash',
          columnNames: ['tokenHash'],
          isUnique: true,
        }),
      );
    }

    // Create password_reset_tokens table
    const passwordResetTokensExists = await queryRunner.hasTable(
      'password_reset_tokens',
    );
    if (!passwordResetTokensExists) {
      await queryRunner.createTable(
        new Table({
          name: 'password_reset_tokens',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              default: 'uuid_generate_v4()',
            },
            {
              name: 'userId',
              type: 'uuid',
              isNullable: false,
            },
            {
              name: 'tokenHash',
              type: 'varchar',
              length: '64',
              isNullable: false,
              isUnique: true,
            },
            {
              name: 'expiresAt',
              type: 'timestamp',
              isNullable: false,
            },
            {
              name: 'usedAt',
              type: 'timestamp',
              isNullable: true,
            },
            {
              name: 'createdAt',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
              isNullable: false,
            },
          ],
        }),
        true,
      );

      await queryRunner.createForeignKey(
        'password_reset_tokens',
        new TableForeignKey({
          columnNames: ['userId'],
          referencedTableName: 'users',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );

      await queryRunner.createIndex(
        'password_reset_tokens',
        new TableIndex({
          name: 'IDX_password_reset_tokens_userId',
          columnNames: ['userId'],
        }),
      );

      await queryRunner.createIndex(
        'password_reset_tokens',
        new TableIndex({
          name: 'IDX_password_reset_tokens_tokenHash',
          columnNames: ['tokenHash'],
          isUnique: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop password_reset_tokens table
    const passwordResetTokensExists = await queryRunner.hasTable(
      'password_reset_tokens',
    );
    if (passwordResetTokensExists) {
      await queryRunner.dropTable('password_reset_tokens', true, true, true);
    }

    // Drop email_tokens table
    const emailTokensExists = await queryRunner.hasTable('email_tokens');
    if (emailTokensExists) {
      await queryRunner.dropTable('email_tokens', true, true, true);
    }

    // Drop emailVerifiedAt column from users
    const usersTable = await queryRunner.getTable('users');
    if (usersTable && usersTable.findColumnByName('emailVerifiedAt')) {
      await queryRunner.dropColumn('users', 'emailVerifiedAt');
    }
  }
}