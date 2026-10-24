import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

/**
 * Static checks on src/migrations (#358). The full check, running every
 * migration on an empty Postgres and then `migration:check`, runs in the
 * Migrations workflow; these catch the cheap mistakes without a database.
 */
const migrationsDir = join(__dirname, 'migrations');
const migrationFiles = readdirSync(migrationsDir).filter((file) =>
  /\.(t|j)s$/.test(file),
);
const migrationSources = migrationFiles.map((file) =>
  readFileSync(join(migrationsDir, file), 'utf8'),
);

/** TypeORM orders migrations by the 13-digit timestamp ending the class name. */
const classTimestamp = (source: string): string | undefined =>
  /class\s+[A-Za-z_]+?(\d{13})\b/.exec(source)?.[1];

function findEntityFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return findEntityFiles(path);
    return entry.name.endsWith('.entity.ts') ? [path] : [];
  });
}

describe('migration chain', () => {
  it('gives every migration a unique timestamp', () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    migrationFiles.forEach((file, i) => {
      const timestamp = classTimestamp(migrationSources[i]);
      expect(timestamp).toBeDefined();
      const other = seen.get(timestamp!);
      if (other) duplicates.push(`${timestamp}: ${other} and ${file}`);
      seen.set(timestamp!, file);
    });
    expect(duplicates).toEqual([]);
  });

  it('names each file after its class timestamp', () => {
    const mismatched = migrationFiles.filter(
      (file, i) => !file.startsWith(`${classTimestamp(migrationSources[i])}-`),
    );
    expect(mismatched).toEqual([]);
  });

  it('creates a table for every entity', () => {
    const allMigrations = migrationSources.join('\n');
    const missing: string[] = [];
    for (const file of findEntityFiles(__dirname)) {
      const source = readFileSync(file, 'utf8');
      const explicit = /@Entity\(\s*['"]([a-z_]+)['"]/.exec(source)?.[1];
      // @Entity() without a name uses the class name in snake_case.
      const className = /@Entity\(\s*\)[\s\S]*?export class (\w+)/.exec(
        source,
      )?.[1];
      const table =
        explicit ??
        className?.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
      if (!table) continue;
      const created =
        allMigrations.includes(`CREATE TABLE "${table}"`) ||
        allMigrations.includes(`CREATE TABLE IF NOT EXISTS "${table}"`) ||
        new RegExp(`name:\\s*'${table}'`).test(allMigrations);
      if (!created) missing.push(`${table} (${relative(__dirname, file)})`);
    }
    expect(missing).toEqual([]);
  });
});
