import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as parser from '@babel/parser';
import { convertJestToVitest } from '../src/converter';

/**
 * Real-world fixture suite. Each file in tests/fixtures/ is a jest config
 * snapshot in the shape a real framework/starter ships (Next.js docs, Nx
 * generator output, CRA package.json, Remix community setup, T3 starter,
 * Vue + craco, Vite + jest hybrid). The full converted output and the warning
 * report are snapshotted: regressions on the configs users actually have show
 * up as snapshot diffs.
 */

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const FIXTURES = [
  'next-js.jest.config.js',
  'nx-lib.jest.config.ts',
  'cra.package.json',
  'remix.jest.config.js',
  't3-app.jest.config.cjs',
  'vue-craco.craco.config.js',
  'vite-jest-hybrid.jest.config.ts',
] as const;

const parsesAsTs = (code: string): boolean => {
  try {
    parser.parse(code, { sourceType: 'module', plugins: ['typescript'] });
    return true;
  } catch {
    return false;
  }
};

describe('real-world fixture suite', () => {
  for (const name of FIXTURES) {
    describe(name, () => {
      const input = readFileSync(join(fixturesDir, name), 'utf8');
      const result = convertJestToVitest(input);

      it('snapshots the converted vitest.config.ts output', () => {
        expect(result.output).toMatchSnapshot();
      });

      it('snapshots the warning report (tier:code → message)', () => {
        const report = result.warnings.map((w) => `${w.type}:${w.code} — ${w.message}`);
        expect(report).toMatchSnapshot();
      });

      it('snapshots the detection flags', () => {
        expect(result.flags).toMatchSnapshot();
      });

      it('renders output that parses as valid TypeScript', () => {
        expect(parsesAsTs(result.output)).toBe(true);
      });

      it('attaches a stable code to every warning', () => {
        for (const w of result.warnings) {
          expect(w.code, `warning without code: ${w.message}`).toBeTruthy();
        }
      });

      it('produces byte-identical output across runs', () => {
        const again = convertJestToVitest(input);
        expect(again.output).toBe(result.output);
        expect(again.warnings).toEqual(result.warnings);
      });
    });
  }
});
