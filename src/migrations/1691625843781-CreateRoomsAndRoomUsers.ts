import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';

export class CreateRoomsAndRoomUsers1691625843781 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Every table's uuid primary key defaults to uuid_generate_v4(). This is the
    // first migration in the chain, so the extension is enabled here.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // Create rooms table
    await queryRunner.createTable(
      new Table({
        name: 'rooms',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'name',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'lyricId',
            type: 'integer',
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'expiresAt',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'isClosed',
            type: 'boolean',
            default: false,
          },
        ],
      }),
      true,
    );

    // Create room_users table
    await queryRunner.createTable(
      new Table({
        name: 'room_users',
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
            type: 'integer',
          },
          {
            name: 'roomId',
            type: 'uuid',
          },
          {
            name: 'hasGuessed',
            type: 'boolean',
            default: false,
          },
          {
            name: 'score',
            type: 'float',
            default: 0,
          },
          {
            name: 'guess',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'joinedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'guessedAt',
            type: 'timestamp',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // The foreign keys to `lyrics` and `users` are added by
    // RepairSchemaToMatchEntities, once those tables exist.
    await queryRunner.createForeignKey(
      'room_users',
      new TableForeignKey({
        columnNames: ['roomId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'rooms',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('room_users');
    await queryRunner.dropTable('rooms');
  }
}
