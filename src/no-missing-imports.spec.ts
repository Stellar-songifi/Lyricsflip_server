import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['src', 'test'];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json'];

function walk(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) {
    return files;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
        continue;
      }
      walk(full, files);
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function isSourceFile(file: string): boolean {
  return /\.(ts|tsx|js|jsx)$/.test(file) && !file.endsWith('.d.ts');
}

function extractImports(content: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    // import ... from 'x'
    /(?:^|\n)\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    // export ... from 'x'
    /(?:^|\n)\s*export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
    // require('x')
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    // dynamic import('x')
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function resolveImport(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates: string[] = [];

  // Exact match first
  candidates.push(base);
  for (const ext of EXTENSIONS) {
    candidates.push(base + ext);
  }
  for (const ext of EXTENSIONS) {
    candidates.push(path.join(base, 'index' + ext));
  }

  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      // not found, continue
    }
  }
  return null;
}

describe('no missing relative imports', () => {
  it('every relative import in src/ and test/ resolves to an existing file', () => {
    const missing: string[] = [];

    for (const dir of SCAN_DIRS) {
      const absDir = path.join(ROOT, dir);
      const files = walk(absDir).filter(isSourceFile);
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        const specifiers = extractImports(content);
        for (const specifier of specifiers) {
          if (!isRelative(specifier)) {
            continue;
          }
          const resolved = resolveImport(file, specifier);
          if (!resolved) {
            const rel = path.relative(ROOT, file);
            missing.push(`${rel} -> ${specifier}`);
          }
        }
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Found ${missing.length} missing relative import(s):\n` + missing.join('\n'),
      );
    }
    expect(missing).toEqual([]);
  });
});