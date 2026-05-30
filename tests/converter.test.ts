import { describe, it, expect } from 'vitest';
import { convertJestToVitest } from '../src/converter';

const messages = (warnings: { message: string }[]) => warnings.map((w) => w.message);

describe('convertJestToVitest — input shape coverage', () => {
  it('handles module.exports = {...}', () => {
    const r = convertJestToVitest("module.exports = { testEnvironment: 'node' };");
    expect(r.output).toContain("environment: 'node'");
    expect(r.output).toContain("import { defineConfig } from 'vitest/config'");
  });

  it('handles export default {...}', () => {
    const r = convertJestToVitest("export default { testTimeout: 5000 };");
    expect(r.output).toContain('testTimeout: 5000');
  });

  it('handles export default defineConfig({...})', () => {
    const r = convertJestToVitest("export default defineConfig({ bail: 1 });");
    expect(r.output).toContain('bail: 1');
  });

  it('resolves const config = {...}; module.exports = config;', () => {
    const r = convertJestToVitest(
      "const config = { testEnvironment: 'jsdom' }; module.exports = config;"
    );
    expect(r.output).toContain("environment: 'jsdom'");
  });

  it('unwraps satisfies Config', () => {
    const r = convertJestToVitest(
      "export default { testEnvironment: 'jsdom' } satisfies Config;"
    );
    expect(r.output).toContain("environment: 'jsdom'");
  });

  it('extracts function-form arrow configs and warns', () => {
    const r = convertJestToVitest("module.exports = () => ({ maxWorkers: 1 });");
    expect(r.output).toContain('maxWorkers: 1');
    expect(messages(r.warnings).some((m) => m.includes('function-form config'))).toBe(true);
  });

  it('extracts async function-form configs', () => {
    const r = convertJestToVitest(
      "module.exports = async () => ({ testEnvironment: 'jsdom' });"
    );
    expect(r.output).toContain("environment: 'jsdom'");
    expect(messages(r.warnings).some((m) => m.includes('function-form config'))).toBe(true);
  });

  it('extracts function-expression configs via return statement', () => {
    const r = convertJestToVitest(
      "module.exports = function() { return { testTimeout: 10000 }; };"
    );
    expect(r.output).toContain('testTimeout: 10000');
  });

  it('extracts embedded jest block from a vue.config-style file', () => {
    const r = convertJestToVitest(
      "module.exports = { devServer: { port: 8080 }, configureWebpack: {}, jest: { testEnvironment: 'jsdom' } };"
    );
    expect(r.output).toContain("environment: 'jsdom'");
    expect(r.output).not.toContain('devServer');
    expect(r.flags.embeddedParent).toBe('vue.config');
  });

  it('extracts embedded jest block from a craco.config-style file', () => {
    const r = convertJestToVitest(
      "module.exports = { webpack: { configure: {} }, eslint: {}, jest: { collectCoverage: true } };"
    );
    expect(r.output).toContain('coverage: {');
    expect(r.output).toContain('enabled: true');
    expect(r.flags.embeddedParent).toBe('craco.config');
  });

  it('reads jest key from package.json input', () => {
    const r = convertJestToVitest(
      JSON.stringify({ name: 'app', jest: { testEnvironment: 'jsdom' } })
    );
    expect(r.output).toMatch(/environment:\s*["']jsdom["']/);
  });
});

describe('convertJestToVitest — output shape correctness', () => {
  it('emits moduleFileExtensions under resolve.extensions, not resolve.alias', () => {
    const r = convertJestToVitest(
      "module.exports = { moduleFileExtensions: ['ts', 'tsx', 'js'] };"
    );
    expect(r.output).toMatch(/extensions:\s*\[/);
    // Should not appear inside alias
    expect(r.output).not.toMatch(/alias:\s*\{[^}]*extensions/);
  });

  it('maps moduleDirectories to test.deps.moduleDirectories', () => {
    const r = convertJestToVitest(
      "module.exports = { moduleDirectories: ['node_modules', 'src'] };"
    );
    expect(r.output).toContain('deps:');
    expect(r.output).toContain('moduleDirectories');
  });

  it('does not map automock to mockReset', () => {
    const r = convertJestToVitest('module.exports = { automock: false };');
    expect(r.output).not.toContain('mockReset:');
    expect(r.output).not.toContain('automock:');
  });

  it('maps resetMocks to Vitest mockReset', () => {
    const r = convertJestToVitest('module.exports = { resetMocks: true };');
    expect(r.output).toContain('mockReset: true');
    expect(r.output).not.toContain('resetMocks:');
  });

  it('honors fakeTimers.enableGlobally: false (omits fakeTimers)', () => {
    const r = convertJestToVitest(
      'module.exports = { fakeTimers: { enableGlobally: false } };'
    );
    expect(r.output).not.toContain('fakeTimers:');
  });

  it('does not emit fakeTimers.install for global fake timers', () => {
    const r = convertJestToVitest(
      'module.exports = { fakeTimers: { enableGlobally: true, now: 123 } };'
    );
    expect(r.output).toContain('fakeTimers: { now: 123 }');
    expect(r.output).not.toContain('install: true');
    expect(r.output).not.toContain('enableGlobally');
    expect(messages(r.warnings).some((m) => m.includes('enableGlobally: true'))).toBe(true);
  });

  it("does not map timers: 'fake' to fakeTimers.install", () => {
    const r = convertJestToVitest("module.exports = { timers: 'fake' };");
    expect(r.output).not.toContain('fakeTimers:');
    expect(messages(r.warnings).some((m) => m.includes("timers: 'fake'"))).toBe(true);
  });

  it('keeps snapshotFormat as snapshotFormat', () => {
    const r = convertJestToVitest(
      'module.exports = { snapshotFormat: { escapeString: true } };'
    );
    expect(r.output).toContain('snapshotFormat: {');
    expect(r.output).not.toContain('snapshotOptions:');
  });

  it('does not emit globalTeardown as a Vitest config key', () => {
    const r = convertJestToVitest(
      "module.exports = { globalTeardown: './teardown.ts' };"
    );
    expect(r.output).not.toMatch(/^\s+globalTeardown:/m);
    expect(r.output).toContain('// MANUAL: globalTeardown');
    expect(messages(r.warnings).some((m) => m.includes('globalTeardown'))).toBe(true);
  });

  it('maps collectCoverage: true to coverage.enabled: true', () => {
    const r = convertJestToVitest('module.exports = { collectCoverage: true };');
    expect(r.output).toContain('coverage: {');
    expect(r.output).toContain('enabled: true');
  });

  it('splits negated collectCoverageFrom globs into coverage.exclude', () => {
    const r = convertJestToVitest(
      "module.exports = { collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'] };"
    );
    expect(r.output).toMatch(/include: \[['"]src\/\*\*\/\*\.ts['"]\]/);
    expect(r.output).toMatch(/exclude: \[['"]src\/\*\*\/\*\.d\.ts['"]\]/);
  });

  it('converts simple Jest ignore path patterns to Vitest globs', () => {
    const r = convertJestToVitest(
      "module.exports = { testPathIgnorePatterns: ['<rootDir>/build/'], coveragePathIgnorePatterns: ['<rootDir>/generated/'] };"
    );
    expect(r.output).toMatch(/exclude: \[['"]build\/\*\*['"]\]/);
    expect(r.output).toMatch(/exclude: \[['"]generated\/\*\*['"]\]/);
  });

  it('keeps regex-like Jest ignore patterns out of Vitest glob config', () => {
    const r = convertJestToVitest(
      "module.exports = { testPathIgnorePatterns: ['node_modules/(?!(foo)/)'], coveragePathIgnorePatterns: ['\\\\.stories\\\\.tsx$'] };"
    );
    expect(r.output).toContain('// MANUAL: testPathIgnorePatterns regex');
    expect(r.output).toContain('// MANUAL: coveragePathIgnorePatterns regex');
    expect(r.output).not.toMatch(/^\s+exclude:\s*\[[^\]]*node_modules\/\(\?!/m);
    expect(r.output).not.toMatch(/^\s+exclude:\s*\[[^\]]*stories/m);
    expect(messages(r.warnings).filter((m) => m.includes('regex pattern')).length).toBeGreaterThanOrEqual(2);
  });

  it('maps bail: true to numeric bail', () => {
    const r = convertJestToVitest('module.exports = { bail: true };');
    expect(r.output).toContain('bail: 1');
    expect(r.output).not.toContain('bail: true');
  });

  it('unwraps coverageThreshold.global for Vitest thresholds', () => {
    const r = convertJestToVitest(`module.exports = {
      coverageThreshold: {
        global: { lines: 80, branches: 75 },
        './src/critical.ts': { lines: 95 },
      },
    };`);
    expect(r.output).toContain('thresholds: {');
    expect(r.output).toContain('lines: 80');
    expect(r.output).toContain('branches: 75');
    expect(r.output).toMatch(/['"]\.\/src\/critical\.ts['"]:\s*\{\s*lines:\s*95\s*\}/);
    expect(r.output).not.toMatch(/global:\s*\{/);
  });

  it('maps Jest babel coverage provider to Vitest istanbul provider and install step', () => {
    const r = convertJestToVitest(
      "module.exports = { collectCoverage: true, coverageProvider: 'babel' };"
    );
    expect(r.output).toContain("provider: 'istanbul'");
    expect(r.output).toContain('npm install -D @vitest/coverage-istanbul');
    expect(r.output).not.toContain('npm install -D @vitest/coverage-v8');
  });

  it('maps testURL to environmentOptions.jsdom.url', () => {
    const r = convertJestToVitest(
      "module.exports = { testURL: 'http://localhost' };"
    );
    expect(r.output).toContain('environmentOptions');
    expect(r.output).toContain("jsdom: { url: 'http://localhost' }");
  });

  it('normalizes Jest environment package names', () => {
    const jsdom = convertJestToVitest(
      "module.exports = { testEnvironment: 'jest-environment-jsdom' };"
    );
    expect(jsdom.output).toContain("environment: 'jsdom'");
    expect(jsdom.flags.needsJsdom).toBe(true);

    const node = convertJestToVitest(
      "module.exports = { testEnvironment: 'jest-environment-node' };"
    );
    expect(node.output).toContain("environment: 'node'");
  });

  it('reads plain jest.config.json input as a Jest config object', () => {
    const r = convertJestToVitest(
      JSON.stringify({ testEnvironment: 'node', bail: true })
    );
    expect(r.output).toMatch(/environment: ['"]node['"]/);
    expect(r.output).toContain('bail: 1');
  });

  it('maps singleThread/singleFork to maxWorkers:1 + isolate:false', () => {
    const r = convertJestToVitest(
      "module.exports = { poolOptions: { threads: { singleThread: true } } };"
    );
    expect(r.output).toContain('maxWorkers: 1');
    expect(r.output).toContain('isolate: false');
  });

  it('extracts package names from transformIgnorePatterns', () => {
    const r = convertJestToVitest(
      "module.exports = { transformIgnorePatterns: ['node_modules/(?!(swiper|nanoid)/)'] };"
    );
    expect(r.output).toContain("inline: ['swiper', 'nanoid']");
  });

  it('moves object globals to root-level define and strips ts-jest', () => {
    const r = convertJestToVitest(
      "module.exports = { globals: { __DEV__: true, 'ts-jest': { isolatedModules: true } } };"
    );
    expect(r.output).toContain('define: {');
    expect(r.output).toContain('__DEV__: true');
    expect(r.output).not.toContain("'ts-jest'");
  });

  it('maps injectGlobals: true to Vitest globals and TypeScript next step', () => {
    const r = convertJestToVitest('module.exports = { injectGlobals: true };');
    expect(r.output).toContain('globals: true');
    expect(r.output).toContain('Add "vitest/globals" to compilerOptions.types');
    expect(r.flags.usesGlobalsTrue).toBe(true);
  });

  it('omits injectGlobals: false because explicit imports are Vitest default', () => {
    const r = convertJestToVitest('module.exports = { injectGlobals: false };');
    expect(r.output).not.toContain('globals:');
    expect(r.flags.usesGlobalsTrue).toBe(false);
  });

  it('converts slowTestThreshold seconds to Vitest milliseconds', () => {
    const r = convertJestToVitest('module.exports = { slowTestThreshold: 5 };');
    expect(r.output).toContain('slowTestThreshold: 5000');
  });

  it('preserves testSequencer as a manual comment instead of unsafe sequence output', () => {
    const r = convertJestToVitest("module.exports = { testSequencer: './sequencer.js' };");
    expect(r.output).toContain('// MANUAL: testSequencer');
    expect(r.output).not.toMatch(/^\s+sequence:/m);
    expect(messages(r.warnings).some((m) => m.includes('testSequencer'))).toBe(true);
  });

  it('maps randomize to sequence.shuffle and warns about showSeed', () => {
    const r = convertJestToVitest('module.exports = { randomize: true, showSeed: true };');
    expect(r.output).toContain('sequence: { shuffle: true }');
    expect(messages(r.warnings).some((m) => m.includes('showSeed'))).toBe(true);
  });

  it('merges setupFiles and setupFilesAfterEnv into one test.setupFiles', () => {
    const r = convertJestToVitest(
      "module.exports = { setupFiles: ['a.ts'], setupFilesAfterEnv: ['b.ts'] };"
    );
    const setupCount = (r.output.match(/setupFiles:/g) ?? []).length;
    expect(setupCount).toBe(1);
    expect(r.output).toContain('a.ts');
    expect(r.output).toContain('b.ts');
  });

  it('rewrites relative aliases with path.resolve(__dirname, ...)', () => {
    const r = convertJestToVitest(
      "module.exports = { moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' } };"
    );
    expect(r.output).toContain('path.resolve(__dirname,');
    expect(r.output).toContain("import path from 'node:path'");
  });

  it('uses the first static moduleNameMapper array fallback with a warning', () => {
    const r = convertJestToVitest(
      "module.exports = { moduleNameMapper: { '^legacy$': ['modern-package', 'legacy-package'] } };"
    );
    expect(r.output).toContain("legacy: 'modern-package'");
    expect(r.output).not.toContain('legacy-package');
    expect(messages(r.warnings).some((m) => m.includes('multiple fallback targets'))).toBe(true);
  });

  it('emits vite-tsconfig-paths plugin when pathsToModuleNameMapper is detected', () => {
    const r = convertJestToVitest(
      "module.exports = { moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths) };"
    );
    expect(r.output).toContain('vite-tsconfig-paths');
    expect(r.output).toContain('tsconfigPaths()');
  });

  it('emits explicit guidance for warn-only Jest fields', () => {
    const r = convertJestToVitest(`module.exports = {
      modulePathIgnorePatterns: ['<rootDir>/fixtures/'],
      resetModules: true,
      snapshotResolver: './snapshotResolver.js',
      testResultsProcessor: './processor.js',
      waitForUnhandledRejections: true,
    };`);
    const warningText = messages(r.warnings).join('\n');
    expect(r.output).toContain('// MANUAL: modulePathIgnorePatterns');
    expect(r.output).toContain('// MANUAL: snapshotResolver');
    expect(r.output).toContain('// MANUAL: testResultsProcessor');
    expect(warningText).toContain('modulePathIgnorePatterns');
    expect(warningText).toContain('resetModules');
    expect(warningText).toContain('snapshotResolver');
    expect(warningText).toContain('testResultsProcessor');
    expect(warningText).toContain('waitForUnhandledRejections');
  });
});

describe('convertJestToVitest — output mode', () => {
  it('emits standalone vitest/config import by default', () => {
    const r = convertJestToVitest("module.exports = { testEnvironment: 'node' };");
    expect(r.output).toContain("from 'vitest/config'");
    expect(r.output).not.toContain("/// <reference");
  });

  it('emits merge-into-Vite output when mode=merge', () => {
    const r = convertJestToVitest(
      "module.exports = { testEnvironment: 'node' };",
      { mode: 'merge' }
    );
    expect(r.output).toContain('/// <reference types="vitest/config" />');
    expect(r.output).toContain("from 'vite'");
  });
});

describe('convertJestToVitest — behavioral warnings', () => {
  it('emits vi.mock hoisting warning when mocking signal is present', () => {
    const r = convertJestToVitest('module.exports = { clearMocks: true };');
    expect(messages(r.warnings).some((m) => m.includes('vi.mock() factories are hoisted'))).toBe(true);
  });

  it('does NOT emit vi.mock hoisting warning when no mocking signal', () => {
    const r = convertJestToVitest('module.exports = { testTimeout: 1000 };');
    expect(messages(r.warnings).some((m) => m.includes('vi.mock() factories are hoisted'))).toBe(false);
  });

  it('emits hook order + done callback warnings when setupFilesAfterEnv is present', () => {
    const r = convertJestToVitest(
      "module.exports = { setupFilesAfterEnv: ['./setup.ts'] };"
    );
    expect(messages(r.warnings).some((m) => m.includes('Hook execution order'))).toBe(true);
    expect(messages(r.warnings).some((m) => m.includes("'done' callback"))).toBe(true);
  });

  it('emits framework snapshot warning when enzyme-to-json is in snapshotSerializers', () => {
    const r = convertJestToVitest(
      "module.exports = { snapshotSerializers: ['enzyme-to-json/serializer'] };"
    );
    expect(messages(r.warnings).some((m) => m.includes('Framework-specific snapshot serializer'))).toBe(true);
  });

  it('emits jest namespace warning for TypeScript-looking inputs', () => {
    const r = convertJestToVitest(
      "export default { testEnvironment: 'jsdom' } satisfies Config;"
    );
    expect(messages(r.warnings).some((m) => m.includes("no global 'jest' namespace"))).toBe(true);
  });

  it('always emits currentTestName separator warning', () => {
    const r = convertJestToVitest("module.exports = {};");
    const warning = messages(r.warnings).find((m) => m.includes('currentTestName'));
    expect(warning).toContain('Jest joins describe/test names with a space');
    expect(warning).toContain("Vitest uses ' > '");
  });
});

describe('convertJestToVitest — flags', () => {
  it('reports needsJsdom for testEnvironment: jsdom', () => {
    const r = convertJestToVitest("module.exports = { testEnvironment: 'jsdom' };");
    expect(r.flags.needsJsdom).toBe(true);
  });

  it('reports needsCoverage when collectCoverageFrom is set', () => {
    const r = convertJestToVitest(
      "module.exports = { collectCoverageFrom: ['src/**/*.ts'] };"
    );
    expect(r.flags.needsCoverage).toBe(true);
  });

  it('reports needsTsconfigPaths for pathsToModuleNameMapper', () => {
    const r = convertJestToVitest(
      "module.exports = { moduleNameMapper: pathsToModuleNameMapper(paths) };"
    );
    expect(r.flags.needsTsconfigPaths).toBe(true);
  });

  it('reports monorepo signal for relative preset', () => {
    const r = convertJestToVitest(
      "module.exports = { preset: '../../jest.shared.js' };"
    );
    expect(r.flags.monorepo).toBe(true);
  });

  it('reports usesGlobalsTrue when globals: true', () => {
    const r = convertJestToVitest('module.exports = { globals: true };');
    expect(r.flags.usesGlobalsTrue).toBe(true);
  });
});

describe('convertJestToVitest — dedup and merging', () => {
  it('deduplicates identical warnings', () => {
    const r = convertJestToVitest(
      "module.exports = { setupFiles: ['a.ts'], setupFilesAfterEnv: ['b.ts'], collectCoverage: true, collectCoverageFrom: ['src'] };"
    );
    const seen = new Set<string>();
    for (const w of r.warnings) {
      const key = `${w.type}::${w.message}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('merges verbose + reporters into one reporters key', () => {
    const r = convertJestToVitest(
      "module.exports = { verbose: true, reporters: ['default'] };"
    );
    const reporterCount = (r.output.match(/reporters:/g) ?? []).length;
    expect(reporterCount).toBe(1);
  });
});

describe('convertJestToVitest — Use Cases from PROBLEM GUIDE', () => {
  it('Use Case 1: simple React app', () => {
    const r = convertJestToVitest(`module.exports = {
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
      moduleNameMapper: {
        '\\\\.(css|less|scss)$': 'identity-obj-proxy',
        '^@/(.*)$': '<rootDir>/src/$1',
      },
      collectCoverageFrom: ['src/**/*.{ts,tsx}'],
    };`);
    expect(r.output).toContain("environment: 'jsdom'");
    expect(r.output).toContain('setupFiles');
    expect(r.output).toContain('alias');
    expect(r.flags.needsJsdom).toBe(true);
    expect(r.flags.needsCoverage).toBe(true);
  });

  it('Use Case 4: pathsToModuleNameMapper', () => {
    const r = convertJestToVitest(`module.exports = {
      preset: 'ts-jest',
      moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths),
    };`);
    expect(r.output).toContain('vite-tsconfig-paths');
    expect(r.flags.needsTsconfigPaths).toBe(true);
  });

  it('Use Case 6: globals object', () => {
    const r = convertJestToVitest(`module.exports = {
      globals: {
        __DEV__: true,
        API_URL: '"https://api.example.com"',
        'ts-jest': { isolatedModules: true },
      },
    };`);
    expect(r.output).toContain('define: {');
    expect(r.output).toContain('__DEV__: true');
    expect(r.output).not.toContain("'ts-jest'");
  });

  it('Use Case 10: package.json with jest key', () => {
    const r = convertJestToVitest(JSON.stringify({
      name: 'my-pkg',
      version: '1.0.0',
      jest: { testEnvironment: 'jsdom', setupFiles: ['./setup.ts'] },
    }));
    expect(r.output).toMatch(/environment:\s*["']jsdom["']/);
    expect(r.output).toContain('setupFiles');
  });
});

describe('convertJestToVitest — globalSetup ESM detection', () => {
  it('warns when globalSetup points to a .js file', () => {
    const r = convertJestToVitest("module.exports = { globalSetup: './global-setup.js' };");
    expect(r.output).toContain("globalSetup: './global-setup.js'");
    expect(r.output).toContain('// VERIFY:');
    expect(messages(r.warnings).some((m) => m.includes('CommonJS extension'))).toBe(true);
  });

  it('warns when globalSetup points to a .cjs file', () => {
    const r = convertJestToVitest("module.exports = { globalSetup: './setup.cjs' };");
    expect(messages(r.warnings).some((m) => m.includes('CommonJS extension'))).toBe(true);
  });

  it('does not warn for .mjs / .ts / .mts globalSetup files', () => {
    for (const ext of ['mjs', 'ts', 'mts']) {
      const r = convertJestToVitest(`module.exports = { globalSetup: './setup.${ext}' };`);
      expect(messages(r.warnings).some((m) => m.includes('CommonJS extension'))).toBe(false);
    }
  });

  it('warns when globalSetup is an array containing .js entries', () => {
    const r = convertJestToVitest("module.exports = { globalSetup: ['./a.ts', './b.js'] };");
    expect(messages(r.warnings).some((m) => m.includes('./b.js'))).toBe(true);
  });
});

describe('convertJestToVitest — vite-plugin-svgr emission', () => {
  it('emits svgr plugin only when the target is an SVG-to-component transformer', () => {
    const r = convertJestToVitest(
      "module.exports = { moduleNameMapper: { '\\\\.svg$': 'jest-svg-transformer' } };"
    );
    expect(r.output).toContain("import svgr from 'vite-plugin-svgr'");
    expect(r.output).toContain('plugins: [svgr()]');
    expect(r.output).toContain('npm install -D vite-plugin-svgr');
    expect(r.flags.needsSvgr).toBe(true);
  });

  it('recognizes @svgr/* transformers as svgr targets', () => {
    const r = convertJestToVitest(
      "module.exports = { moduleNameMapper: { '\\\\.(svg)$': '@svgr/webpack' } };"
    );
    expect(r.output).toContain('plugins: [svgr()]');
    expect(r.flags.needsSvgr).toBe(true);
  });

  it('does NOT emit svgr plugin for non-SVG asset stubs', () => {
    const r = convertJestToVitest(
      "module.exports = { moduleNameMapper: { '\\\\.(png|jpg)$': '<rootDir>/test/file-mock.js' } };"
    );
    expect(r.output).not.toContain('vite-plugin-svgr');
    expect(r.flags.needsSvgr).toBe(false);
  });

  it('does NOT emit svgr when an SVG key maps to a generic file mock', () => {
    const r = convertJestToVitest(
      "module.exports = { moduleNameMapper: { '\\\\.(png|jpg|svg)$': '<rootDir>/test/file-mock.js' } };"
    );
    expect(r.output).not.toContain('vite-plugin-svgr');
    expect(r.flags.needsSvgr).toBe(false);
    // The SVG/asset key is reported for review rather than silently transformed.
    expect(messages(r.warnings).some((m) => m.includes('Asset stub'))).toBe(true);
  });

  it('does NOT emit svgr when an SVG key maps to identity-obj-proxy', () => {
    const r = convertJestToVitest(
      "module.exports = { moduleNameMapper: { '\\\\.svg$': 'identity-obj-proxy' } };"
    );
    expect(r.output).not.toContain('vite-plugin-svgr');
    expect(r.flags.needsSvgr).toBe(false);
  });
});

describe('convertJestToVitest — inline warning comments', () => {
  it('attaches an inline VERIFY note to mockReset when mapped from resetMocks', () => {
    const r = convertJestToVitest('module.exports = { resetMocks: true };');
    expect(r.output).toMatch(/mockReset: true,\s*\/\/ VERIFY:/);
  });

  it('attaches an inline VERIFY note to coverage.thresholds', () => {
    const r = convertJestToVitest(`module.exports = {
      coverageThreshold: { global: { lines: 80 } },
    };`);
    expect(r.output).toMatch(/thresholds: \{[^}]*\},\s*\/\/ VERIFY: V8 AST remapping/);
  });

  it('attaches an inline VERIFY note to test.setupFiles when setupFilesAfterEnv is present', () => {
    const r = convertJestToVitest("module.exports = { setupFilesAfterEnv: ['./setup.ts'] };");
    expect(r.output).toMatch(/setupFiles: \[[^\]]*\],\s*\/\/ VERIFY: includes setupFilesAfterEnv/);
  });

  it('attaches an inline VERIFY note to reporters', () => {
    const r = convertJestToVitest("module.exports = { reporters: ['default'] };");
    expect(r.output).toMatch(/reporters: \[[^\]]*\],\s*\/\/ VERIFY: Jest and Vitest built-in reporter names differ/);
  });

  it('attaches an inline VERIFY note to deps when moduleDirectories is mapped', () => {
    const r = convertJestToVitest("module.exports = { moduleDirectories: ['node_modules', 'src'] };");
    expect(r.output).toMatch(/deps: \{[^}]*\},\s*\/\/ VERIFY: source aliasing belongs in resolve\.alias/);
  });
});

describe('convertJestToVitest — pretty-printer', () => {
  it('breaks projects across lines when it has nested objects', () => {
    const r = convertJestToVitest(`module.exports = {
      projects: [
        { displayName: 'unit', testMatch: ['<rootDir>/src/**/*.test.ts'] },
        { displayName: 'integration', testMatch: ['<rootDir>/tests/**/*.spec.ts'] },
      ],
    };`);
    // Two project objects must each be on their own line (no '}, {' on the same line).
    expect(r.output).not.toMatch(/\}, \{/);
    expect(r.output).toMatch(/projects: \[\n[\s\S]*displayName: 'unit'[\s\S]*displayName: 'integration'[\s\S]*\n\s*\],/);
  });

  it('keeps short objects inline', () => {
    const r = convertJestToVitest("module.exports = { coverageThreshold: { global: { lines: 80 } } };");
    expect(r.output).toMatch(/thresholds: \{ lines: 80 \}/);
  });

  it('respects format: false (no pretty-printing)', () => {
    const r = convertJestToVitest(
      `module.exports = {
        projects: [
          { displayName: 'unit', testMatch: ['<rootDir>/src/**/*.test.ts'] },
          { displayName: 'integration', testMatch: ['<rootDir>/tests/**/*.spec.ts'] },
        ],
      };`,
      { format: false }
    );
    // Without formatting the projects value is the raw babel-generator string with '}, {'.
    expect(r.output).toMatch(/\}, \{/);
  });

  it('emits valid JS that re-parses cleanly', async () => {
    const parser = await import('@babel/parser');
    const r = convertJestToVitest(`module.exports = {
      testEnvironment: 'jsdom',
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
      coverageThreshold: { global: { lines: 80, branches: 75 } },
      projects: [
        { displayName: 'unit', testMatch: ['<rootDir>/src/**/*.test.ts'] },
        { displayName: 'integration', testMatch: ['<rootDir>/tests/**/*.spec.ts'] },
      ],
    };`);
    expect(() =>
      parser.parse(r.output, { sourceType: 'module', plugins: ['typescript'] })
    ).not.toThrow();
  });
});

describe('convertJestToVitest — flags', () => {
  it('reports needsSvgr when an SVG-to-component transformer is detected', () => {
    const r = convertJestToVitest(
      "module.exports = { moduleNameMapper: { '\\\\.(svg)$': 'jest-svg-transformer' } };"
    );
    expect(r.flags.needsSvgr).toBe(true);
  });

  it('reports needsSvgr=false by default', () => {
    const r = convertJestToVitest("module.exports = { testEnvironment: 'jsdom' };");
    expect(r.flags.needsSvgr).toBe(false);
  });
});
