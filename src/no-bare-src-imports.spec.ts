import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * #355: importing a bare src/… path compiles (tsconfig baseUrl), but the
 * emitted require of that path crashes `node dist/main`. Every import under
 * src/ must be relative, and ESLint must keep it that way.
 */

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? tsFiles(path)
      : path.endsWith('.ts')
        ? [path]
        : [];
  });
}

describe('no bare src/ imports (#355)', () => {
  it('has no import, require or jest.mock of a src/... path', () => {
    const offenders = tsFiles(__dirname).filter((file) =>
      /(?:from\s+|require\(\s*|import\(\s*|jest\.mock\(\s*)['"]src\//.test(
        readFileSync(file, 'utf8'),
      ),
    );
    expect(offenders.map((f) => relative(__dirname, f))).toEqual([]);
  });

  it('is enforced by ESLint', () => {
    const config = readFileSync(
      join(__dirname, '..', 'eslint.config.mjs'),
      'utf8',
    );
    expect(config).toContain("'no-restricted-imports'");
    expect(config).toContain("group: ['src/*']");
  });
});
