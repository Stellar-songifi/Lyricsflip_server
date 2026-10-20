import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { envValidationSchema } from './env.validation';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('environment validation coverage', () => {
  it('validates every statically accessed environment variable', () => {
    const schemaKeys = new Set(Object.keys(envValidationSchema.describe().keys));
    const accessPattern =
      /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g;
    const sourceRoot = join(__dirname, '..');
    const missing = new Set<string>();

    for (const file of sourceFiles(sourceRoot)) {
      if (!existsSync(file)) continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(accessPattern)) {
        const key = match[1] ?? match[2];
        if (!schemaKeys.has(key)) missing.add(key);
      }
    }

    expect([...missing]).toEqual([]);
  });
});
