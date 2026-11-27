import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs build script, no type declarations
import { OUTPUT, buildNotices } from '../scripts/third-party-notices.mjs';

const ROOT = path.resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(tsx?|css)$/.test(e.name) ? [p] : [];
  });
}

/** Package names that src/ imports, e.g. 'blockly/core' -> 'blockly'. */
function importedPackages(): Set<string> {
  const names = new Set<string>();
  for (const file of sourceFiles(path.join(ROOT, 'src'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:from\s+|import\s+|@import\s+)['"]([^'"./][^'"]*)['"]/g)) {
      const parts = m[1].split('/');
      names.add(m[1].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]);
    }
  }
  return names;
}

describe('third-party notices', () => {
  const { text, packages, missing } = buildNotices();
  const covered = new Set(packages.map((p: { pkg: { name: string } }) => p.pkg.name));

  it('covers every package the app imports', () => {
    const uncovered = [...importedPackages()].filter((n) => !covered.has(n));
    expect(uncovered, 'Add these to BUNDLED_ROOTS in scripts/third-party-notices.mjs').toEqual([]);
  });

  it('has licence text for every package', () => {
    expect(missing).toEqual([]);
  });

  it('is up to date in public/ (run `npm run notices`)', () => {
    expect(fs.readFileSync(OUTPUT, 'utf8')).toBe(text);
  });

  it('ships the project licence and privacy policy', () => {
    expect(fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8')).toMatch(/^MIT License/);
    expect(fs.existsSync(path.join(ROOT, 'PRIVACY.md'))).toBe(true);
  });
});
