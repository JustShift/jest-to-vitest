# Jest → Vitest Config Converter: Problem Research & Implementation Blueprint

## Overview
This document consolidates the pain points developers encounter when migrating `jest.config.js` to `vitest.config.ts`, catalogs every use-case and edge case the converter must handle, and specifies the finalized solution design. The goal is to give a developer everything needed to implement the tool without additional research.

This version has been cross-checked against the current Vitest 4 docs, the official migration guide, the `@namchee/j2v` source, and recent migration write-ups. Vitest 4 specifically removed and renamed enough configuration that a converter built against Vitest 3 assumptions will silently produce slow or broken configs — those breaking changes are called out throughout.

***
## The Problem in Plain Terms
The Jest → Vitest migration has two distinct workloads: converting **test files** (replacing `jest.fn()` with `vi.fn()`, fixing imports, etc.) and converting the **config file** (`jest.config.js` → `vitest.config.ts`). The community has largely automated the first part — codemods exist for test files, and the Vitest 4 release explicitly advertises "automated migration". The config migration, however, is still a fully manual step described in every guide as "the first thing you need to do" with no tool to do it.[1][2]

The pain is real and well-documented. A developer with 400 tests reported the migration "gives a lot of headache" primarily due to the config changes. A team migrating 109 test files noted the config translation as the necessary first step before anything else. A developer at an AI SaaS company in April 2026 noted the migration required budgeting "1–3 hours depending on how many Jest-specific patterns you're using" — and the config translation is the bulk of that time for anyone with a non-trivial setup.[3][4][5]

The search query gap is confirmed: no converter web tool exists. Every search result for "jest config to vitest" lands on blog posts asking you to do it manually.[2][6][1]

***
## Why Config Migration Is Actually Painful: Developer Sentiment

### The Non-Obvious Field Renames
The surface-level migration looks simple — but the subtle renames are exactly what burns developers. Real examples from migration logs and GitHub issues:

- `setupFilesAfterEnv` → `setupFiles` (the "After" part is dropped and the semantics shift slightly)[1][5]
- `collectCoverageFrom` → `coverage.include` (moved into a sub-object, different key name)[7]
- `testPathIgnorePatterns` → `exclude` only after converting safe path-like entries to globs; regex entries need a manual warning because Vitest expects glob patterns[2][8]
- `moduleNameMapper` has no direct equivalent — it splits into `resolve.alias` for path aliases and plugin-based solutions for file stubs[9][10]
- `transform` becomes unnecessary in most setups since Vitest handles TypeScript natively[1][2]
- `globals` in Jest means passing arbitrary values into tests; in Vitest `globals: true` means something completely different (enabling Jest-style implicit globals)[11]

### The `transform` / `preset` Time Sink
The single most painful area is `transform` and `preset`. Most Jest configs have patterns like:

```js
preset: 'ts-jest',
transform: {
  '^.+\\.tsx?$': 'ts-jest',
  '\\.(css|scss)$': 'identity-obj-proxy',
},
transformIgnorePatterns: ['node_modules/(?!(some-esm-package)/)'],
```

Vitest doesn't need any of this for TypeScript — it uses Vite's transform pipeline natively. But developers don't know this and spend hours trying to find Vitest equivalents for each transformer. One real-world codebase maintained a list of 15+ ESM packages to transform. The correct Vitest answer is: delete all of it. The converter must explain *why* the field disappears rather than just omitting it silently.[12]

### The Coverage Gotchas
Coverage configuration changes significantly and silently breaks when migrated naively:[7][8]

- `collectCoverage: true` → no direct equivalent (coverage is triggered via CLI flag `--coverage`)
- `collectCoverageFrom` → `coverage.include` (but path resolution changed: Vitest uses absolute-style globs, Jest accepted `<rootDir>` tokens)[7]
- `coverageThreshold` → `coverage.thresholds` (sub-object restructure)[7]
- `coverageDirectory` → `coverage.reportsDirectory`
- `coverageReporters` → `coverage.reporter`
- `coverage.all` was removed in Vitest 4 — any config using it will silently fail or error[8]
- `coverage.ignoreEmptyLines` was also removed in Vitest 4 — same treatment as `coverage.all`
- Vitest 4's V8 coverage now uses AST-based remapping (more accurate than v3). Coverage **thresholds that previously passed may now fail** — emit a "review coverage thresholds after migration" warning whenever `coverageThreshold` is present.

### The ESM / CommonJS Problem
Developers coming from projects that used `transformIgnorePatterns` to force ESM packages through Jest's CommonJS transform are surprised to find this is unnecessary in Vitest, which handles ESM natively. However, some packages still need explicit inline treatment using `server.deps.inline`. This is a source of major confusion because the old config key doesn't just rename — the entire mental model changes.[2][8][12]

Important: Vitest 4 explicitly removed the bare `deps.inline`, `deps.external`, and `deps.fallbackCJS` forms. The converter must always emit `server.deps.inline` (the nested form), never the deprecated top-level `deps.*` form.

### The `__mocks__` Auto-Loading Difference
In Jest, files placed in a `__mocks__` directory are loaded automatically. In Vitest they are **not** — `vi.mock()` must be called explicitly, or the mocks must be added to `setupFiles`. This isn't a config key change, but it's a behavioral difference that the converter should warn about when it detects a `roots` or `moduleDirectories` pattern that suggests `__mocks__` usage.[13][8]

### Monorepo / Workspace Pain
Developers in Nx, Turborepo, or pnpm workspaces face additional headaches:[14][15][16]

- Jest generates a `jest.config.ts` per package automatically in Nx. Vitest 3.2 introduced `projects` as the new name (replacing `workspace`), and **Vitest 4 specifically forbids referencing another file as the source of your workspace** — projects must be declared inline inside `vitest.config.ts`. So if a Jest config uses `projects: ['./packages/*']`, the converter should emit a `test.projects` block inside the main config, not generate a separate `vitest.workspace.ts` file.
- Vitest's CLI doesn't default-scope to the current package in a monorepo — it searches from root unless `--root` or `dir` is configured.[15]
- The VS Code Vitest extension doesn't auto-discover configs the way the Jest extension does in monorepos.[17][15]

***
## Vitest 4 Breaking Changes the Converter Must Know About
Vitest 4 removed or renamed enough fields that a Vitest-3-era converter will produce broken or silently-degraded configs. Centralized list:

| Vitest 4 change | Implication for converter |
|---|---|
| `poolOptions` removed entirely | Anything formerly under `poolOptions.threads.*` or `poolOptions.forks.*` moves to top-level |
| `singleThread: true` and `singleFork: true` removed | Equivalent is `maxWorkers: 1` **plus** `isolate: false` |
| `minWorkers` removed | Drop with explanation. Only `maxWorkers` affects parallelism now |
| `workerIdleMemoryLimit` → `vmMemoryLimit` | Rename, but `vmMemoryLimit` only applies to the non-default `vmThreads` pool; pair with a verify warning |
| `poolMatchGlobs` removed | Replaced by `projects` |
| `environmentMatchGlobs` removed | Replaced by `projects` |
| `coverage.all` removed | Replaced by explicit `coverage.include` |
| `coverage.ignoreEmptyLines` removed | Drop with explanation |
| Bare `deps.inline` / `deps.external` / `deps.fallbackCJS` removed | Always emit nested `server.deps.inline` etc. |
| Workspace must be inline | Don't generate `vitest.workspace.ts`; emit `test.projects` block |
| V8 coverage uses AST-based remapping | Warn that previously-passing `coverageThreshold` values may now fail |

A common real-world Jest pattern is `maxWorkers: 1` for CI. Naively translating to Vitest 4 without `isolate: false` reproduces the [active ~2× slowdown issue](https://github.com/vitest-dev/vitest/issues/8808). The converter must always pair `maxWorkers: 1` with `isolate: false` and surface a note.

***
## Complete Field Mapping Reference

### Core Test Discovery
| Jest Field | Vitest Equivalent | Notes |
|---|---|---|
| `testMatch` | `include` | Same glob syntax, same purpose[8][2] |
| `testRegex` | `include` (glob) | Regex → glob is non-trivial; emit a sensible default like `['**/*.{test,spec}.{ts,tsx,js,jsx}']`, preserve original regex as comment, warn user to verify file matching |
| `testPathIgnorePatterns` | `exclude` | Jest entries are regex strings; convert only safe path-like entries to globs and preserve regex-like entries as manual comments[2][8] |
| `roots` | `dir` (or root) | Vitest uses `dir` to scope test discovery[8] |
| `testEnvironment` | `environment` | Values: `node`, `jsdom`, `happy-dom`, `edge-runtime`. Note: `jsdom`/`happy-dom` are **not bundled** — emit npm install hint[18] |
| `testEnvironmentOptions` | `environmentOptions` | Renamed, and the shape changes: Jest's options are flat, Vitest namespaces them per environment (`environmentOptions: { jsdom: { url } }`). Flat keys are ignored by Vitest |
| `testTimeout` | `testTimeout` | Same name, same semantics[8] |
| `slowTestThreshold` | `slowTestThreshold` | Same key, but Jest uses seconds and Vitest uses milliseconds |
| `bail` | `bail` | Vitest expects a number; normalize Jest `true` to `1`[19] |
| `verbose` | reporter config | Use `reporters: ['verbose']` in Vitest[8] |
| `injectGlobals` | `globals` | `true` maps to Vitest `globals: true`; `false` is already Vitest's default explicit-import mode |
| `maxConcurrency` | `maxConcurrency` | Same name, direct rename |
| `extensionsToTreatAsEsm` | *Delete entirely* | Vitest handles ESM natively |
| `errorOnDeprecated` | *No equivalent* | Drop with warning |
| `testFailureExitCode` | *No equivalent* | Vitest always exits non-zero on failure |
| `notify` / `notifyMode` | *No equivalent* | No notification reporter; drop with warning |
| `sandboxInjectedGlobals` | *No equivalent* | Drop with warning |

### Module Resolution
| Jest Field | Vitest Equivalent | Notes |
|---|---|---|
| `moduleNameMapper` (path aliases) | `resolve.alias` | Path alias patterns like `'^@/(.*)$'` move to Vite's resolver[9][10] |
| `moduleNameMapper` (file stubs) | `plugins` or `assetsPlugin` | CSS/image stubs need a Vite plugin (e.g., `vite-plugin-svgr`, or inline plugin)[20][10] |
| `moduleNameMapper: pathsToModuleNameMapper(...)` | `vite-tsconfig-paths` plugin | **Critical** — common in TS projects. Function call cannot be parsed; detect by name and emit `import tsconfigPaths from 'vite-tsconfig-paths'` + `plugins: [tsconfigPaths()]` |
| `moduleFileExtensions` | `resolve.extensions` | Same concept, Vite config key[2] |
| `moduleDirectories` | `resolve.modules` | Same concept, Vite config key |
| `modulePaths` | `resolve.modules` | Merge with above |
| `resolver` (custom resolver) | *No equivalent* | Warn and suggest writing a Vite plugin |
| `unmockedModulePathPatterns` | *No equivalent* | Requires per-test `vi.doUnmock()` calls |

### Setup & Teardown
| Jest Field | Vitest Equivalent | Notes |
|---|---|---|
| `setupFiles` | `setupFiles` | Same name — runs before each test file[1][8] |
| `setupFilesAfterEnv` | `setupFiles` | In Vitest, `setupFiles` covers both; the "after env" distinction doesn't exist[1][5] |
| `globalSetup` | `globalSetup` | Same name[19] |
| `globalTeardown` | *No separate config key* | Vitest teardown must be returned/exported from `globalSetup`; preserve the Jest value as a manual comment and warn[19] |

### Coverage
| Jest Field | Vitest Equivalent | Notes |
|---|---|---|
| `collectCoverage` | CLI `--coverage` flag | Not a config option in Vitest[8] |
| `collectCoverageFrom` | `coverage.include` / `coverage.exclude` | Path tokens change: `<rootDir>` → project-relative glob; split negated entries like `!**/*.d.ts` into `coverage.exclude`[7][8] |
| `coverageDirectory` | `coverage.reportsDirectory` | Renamed[7] |
| `coverageReporters` | `coverage.reporter` | Renamed (singular)[7] |
| `coverageThreshold` | `coverage.thresholds` | Restructured. Unwrap Jest's `coverageThreshold.global` into direct threshold keys and warn that path/glob thresholds count differently against global thresholds in Vitest[7][19] |
| `coveragePathIgnorePatterns` | `coverage.exclude` | Jest entries are regex strings; convert only safe path-like entries to globs and preserve regex-like entries as manual comments[7][8] |
| `coverageProvider: 'babel'` | `coverage.provider: 'istanbul'` | Vitest supports `v8`, `istanbul`, and `custom`; install the matching provider package |
| `forceCoverageMatch` | `coverage.include` | Merge into include patterns |
| `coverage.all` | *REMOVED in Vitest 4* | Replaced by explicit `coverage.include`[8] |
| `coverage.ignoreEmptyLines` | *REMOVED in Vitest 4* | Drop with explanation |

### Transform & Compilation
| Jest Field | Vitest Equivalent | Notes |
|---|---|---|
| `preset: 'ts-jest'` | *Delete entirely* | Vitest handles TS natively via Vite[2][1][5] |
| `preset: 'babel-jest'` | *Delete entirely* | Same — Vite's pipeline replaces babel-jest[2] |
| `transform` (TS files) | *Delete entirely* | Vitest transforms TS/TSX natively[2][1] |
| `transform` (CSS/image stubs) | Vite plugin or `assetsPlugin` | Keep as a warning with suggested plugin[20][10] |
| `transformIgnorePatterns` | `server.deps.inline` | Always nested form; never bare `deps.inline` (removed in Vitest 4)[8] |

### Mocking Behavior
| Jest Field | Vitest Equivalent | Notes |
|---|---|---|
| `automock` | *No direct config equivalent* | Vitest does not provide Jest-style global automocking; warn and require explicit `vi.mock()` calls or setup-file mocks[13] |
| `clearMocks` | `clearMocks` | Same name[19] |
| `resetMocks` | `mockReset` | Vitest's config key is `mockReset`; warn because mock implementation reset semantics still need verification[8] |
| `restoreMocks` | `restoreMocks` | Same name[19] |
| `fakeTimers` | `fakeTimers` | Copy only valid Vitest fake timer options. `enableGlobally` and `legacyFakeTimers` do not map to config[8] |
| `fakeTimers.legacyFakeTimers: true` | *No equivalent* | Hard error/warning — tests using `jest.useFakeTimers('legacy')` will break |
| `fakeTimers.enableGlobally: true` | *No config equivalent* | Add `vi.useFakeTimers()` in setup or per-test code if global fake timers are still required |

### Parallelism & Performance
| Jest Field | Vitest Equivalent | Notes |
|---|---|---|
| `maxWorkers` | `maxWorkers` | Same name. **CI pattern `maxWorkers: 1` must also emit `isolate: false`** to avoid Vitest 4's known ~2× slowdown |
| `runInBand` | `maxWorkers: 1` + `isolate: false` | No direct CLI flag; set in config[21] |
| `testSequencer` | Manual port to `sequence.sequencer` | Similar concept, but Vitest expects a Vitest-compatible sequencer from `vitest/node`; do not copy Jest sequencers directly[19] |
| `randomize` | `sequence.shuffle` | Static booleans can map to Vitest shuffle sequencing |
| `showSeed` | Verify/manual note | Vitest exposes seed/sequence behavior differently; warn users to verify reproducible shuffled runs |
| `workerIdleMemoryLimit` | `vmMemoryLimit` | Renamed in Vitest 4[8] |
| `detectOpenHandles` / `detectLeaks` | `logHeapUsage` + verbose reporter | Different mental model — warn |
| `poolOptions.threads.*` / `poolOptions.forks.*` | top-level | `poolOptions` removed in Vitest 4 |
| `poolOptions.threads.singleThread` | `maxWorkers: 1` + `isolate: false` | Removed in Vitest 4 |
| `poolOptions.forks.singleFork` | `maxWorkers: 1` + `isolate: false` | Removed in Vitest 4 |
| `minWorkers` | *Removed* | Drop — only `maxWorkers` affects parallelism in Vitest 4 |
| `poolMatchGlobs` / `environmentMatchGlobs` | `projects` | Removed in Vitest 4 |

### Reporters & Output
| Jest Field | Vitest Equivalent | Notes |
|---|---|---|
| `reporters` | `reporters` | Same name, different built-in values |
| `verbose` (boolean) | `reporters: ['verbose']` | Moved to reporters array[8] |
| `silent` | `silent` | Same name[19] |

### Snapshot Config
| Jest Field | Vitest Equivalent | Notes |
|---|---|---|
| `snapshotFormat` | `snapshotFormat` | Same Vitest key; copy supported options and warn for unsupported formatter/plugin values[8] |
| `snapshotSerializers` | `snapshotSerializers` | Same name[8] |
| `inlineSnapshot` | Supported natively | No config needed |
| `prettierPath` | *No equivalent* | Vitest uses an internal serializer; remove unless a custom serializer replaces the behavior |

### Watch
| Jest Field | Vitest Equivalent | Notes |
|---|---|---|
| `watchPathIgnorePatterns` | `server.watch.ignored` | Lives in **Vite** config, not test config — easy nesting trap |
| `watchPlugins` | *No equivalent* | Vitest has its own watch mode |

### Multi-Project
| Jest Field | Vitest Equivalent | Notes |
|---|---|---|
| `projects` (Jest's array) | `test.projects` (inline) | Maps cleanly. Vitest 4 requires inline declaration — never emit a separate workspace file |
| `displayName` | `test.name` (per project) | In Vitest projects[19] |

### Fields With No Vitest Equivalent (Generate a Warning)
| Jest Field | Status | What to Tell the User |
|---|---|---|
| `preset` (custom, e.g. `react-native`) | ⚠️ Manual | Platform presets need custom Vitest setup |
| `testRunner` | ⚠️ Manual | Vitest doesn't support swapping test runners |
| `testURL` | ⚠️ Removed | Use `environmentOptions: { jsdom: { url: '...' } }` instead |
| `globals` (object with values) | ⚠️ Renamed | Jest's `globals` for injecting values → `define` in Vite config; Vitest's `globals: true` is a different thing entirely[11] |
| `modulePathIgnorePatterns` | ⚠️ No direct equivalent | Review whether these paths should affect test globs, coverage excludes, or Vite resolution |
| `resetModules` | ⚠️ Behavioral review | Vitest provides `vi.resetModules()` for per-test module cache control; verify isolation expectations |
| `snapshotResolver` | ⚠️ Manual | Port to Vitest `resolveSnapshotPath` manually; the function signature differs |
| `testResultsProcessor` | ⚠️ Manual | Replace with a Vitest reporter or a post-processing step |
| `waitForUnhandledRejections` | ⚠️ Behavioral review | Vitest handles unhandled rejections differently; verify async rejection failures |
| `dependencyExtractor` | ⚠️ No equivalent | Manual migration required |
| `haste` | ❌ N/A | Metro/React Native specific — no equivalent |

***
## Use Cases the Tool Must Handle

### Use Case 1: Simple React App (CRA/Vite Migration)
The most common case. A developer migrating from Create React App (deprecated Feb 2025) has a config like:[22]

```js
// jest.config.js
module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  moduleNameMapper: {
    '\\.(css|less|scss)$': 'identity-obj-proxy',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
```

Expected output:
```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],  // <rootDir> token stripped
  },
  resolve: {
    alias: {
      '@': './src',  // extracted from moduleNameMapper
    },
  },
  // Note: CSS stub (identity-obj-proxy) needs vite-plugin-... or css: false
});
```

**Key transformations:** rename `setupFilesAfterEnv` → `setupFiles`, strip `<rootDir>`, split `moduleNameMapper` into `resolve.alias` + warning for file stubs.[1][10]

### Use Case 2: TypeScript Project with ts-jest
The second most common case — a pure Node.js/TypeScript project:

```js
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: ['./src/**/*.{ts,tsx}'],
  coverageThreshold: {
    global: { lines: 80, functions: 80 },
  },
};
```

Expected output:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: [],
    coverage: {
      include: ['./src/**/*.{ts,tsx}'],
      thresholds: { lines: 80, functions: 80 },
    },
  },
  resolve: {
    alias: { '@app': './src' },
  },
  // ts-jest removed — TypeScript supported natively
});
```

**Key transformations:** delete `preset`, restructure `coverageThreshold` → `coverage.thresholds`, `collectCoverageFrom` → `coverage.include`. Emit a "review thresholds — V8 AST remapping in Vitest 4 may shift values" warning.[7][8][5]

### Use Case 3: Complex React Project with Many Transformers
A real-world large app config:[12][23]

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
    '^.+\\.js$': 'babel-jest',
    '\\.svg$': '<rootDir>/__mocks__/svgMock.js',
    '\\.(css|scss)$': 'jest-transform-stub',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(swiper|nanoid|uuid)/)',
  ],
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  moduleNameMapper: {
    'src/constants': '<rootDir>/__mocks__/constantsMock.ts',
    '^react-localization$': '<rootDir>/node_modules/react-localization/lib/...',
  },
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/index.ts'],
};
```

This is the painful case. The converter must:
1. Delete `preset: 'ts-jest'` with explanation
2. Delete `transform` TS/JS entries with explanation
3. Convert SVG transform stub → warning to use `vite-plugin-svgr` or inline plugin
4. Convert `transformIgnorePatterns` → `server.deps.inline: ['swiper', 'nanoid', 'uuid']` (nested form)
5. Convert `setupFilesAfterEnv` → `setupFiles` with path cleanup
6. Convert `moduleNameMapper` path alias entries → `resolve.alias`
7. Convert `moduleNameMapper` absolute-path entries → `resolve.alias` with warning
8. Convert `collectCoverageFrom` → `coverage.include`[8][10][12]

### Use Case 4: TypeScript Project Using `pathsToModuleNameMapper`
Extremely common in TS projects — and the most important "non-static" case:

```js
const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('./tsconfig.json');

module.exports = {
  preset: 'ts-jest',
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>/' }),
};
```

The converter cannot statically resolve the function call. The right answer: detect the helper by name, **don't try to expand it**, and emit:

```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: { /* ... */ },
});
```

Plus a "next steps" comment to install `vite-tsconfig-paths`. Missing this case would be a major quality gap.

### Use Case 5: Monorepo / Nx Workspace
```js
// packages/my-lib/jest.config.ts
export default {
  displayName: 'my-lib',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: { '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }] },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  coverageDirectory: '../../coverage/packages/my-lib',
};
```

The converter must handle:
1. `preset` referencing a shared base config file → warning that Vitest uses `mergeConfig()` from `vitest/config`[19][24]
2. `displayName` → `test.name` in the per-project block[19]
3. Relative `coverageDirectory` paths → `coverage.reportsDirectory`
4. Output a note that the **root config must declare `test.projects` inline** (Vitest 4 forbids referencing another file as the workspace source). Do not emit a separate `vitest.workspace.ts` file.[8][14][16]

### Use Case 6: Projects Using `globals` Object
```js
module.exports = {
  globals: {
    'ts-jest': { diagnostics: false, tsconfig: '<rootDir>/tsconfig.spec.json' },
    __DEV__: true,
  },
};
```

This is a **critical confusion point** because `globals` in Jest means injecting arbitrary values into the test scope, while in Vitest `globals: true` means something completely different (enabling implicit test function globals like `describe`/`it` without importing). The converter must:[11]
1. Strip `'ts-jest'` key from globals (ts-jest is gone)
2. Convert `__DEV__: true` → `define: { __DEV__: true }` in the Vite config section[11]
3. Generate a prominent warning explaining the semantic difference

### Use Case 7: Fake Timers & Legacy Timer Config
```js
module.exports = {
  fakeTimers: { enableGlobally: true, legacyFakeTimers: false },
  timers: 'legacy', // old Jest syntax
};
```

Mapping:
- `fakeTimers.enableGlobally` → no Vitest config key; add `vi.useFakeTimers()` in setup or per-test code if always-on fake timers are still required[8][19]
- `timers: 'legacy'` → flag as removed; Vitest does not support Jest's legacy timers[8]
- `timers: 'fake'` → no Vitest config key; use setup/per-test `vi.useFakeTimers()` instead
- `legacyFakeTimers: true` → hard warning, tests using `jest.useFakeTimers('legacy')` will break

### Use Case 8: Custom Test Environments
```js
module.exports = {
  testEnvironment: './src/customEnvironment.js',
  testEnvironmentOptions: { url: 'https://example.com' },
};
```

- Custom environment path → preserve as-is with a warning that the environment file must export a Vitest-compatible `Environment` object (different interface from Jest's)[18]
- `testEnvironmentOptions` → `environmentOptions` (renamed)[19][18]
- `testURL` (deprecated in Jest, removed in Vitest) → `environmentOptions: { jsdom: { url: '...' } }`

### Use Case 9: Snapshot Serializers (Vue/React)
```js
module.exports = {
  snapshotSerializers: ['jest-serializer-vue'],
};
```

Direct mapping to Vitest's `snapshotSerializers` — same key, same behavior. The converter should note that Vue snapshot output differences exist in Vitest 4.0 (shadow root printing behavior changed).[8]

### Use Case 10: Configs Living in `package.json`
A surprisingly common pattern, especially for libraries:

```json
{
  "name": "my-lib",
  "jest": {
    "testEnvironment": "node",
    "setupFilesAfterEnv": ["./test/setup.ts"]
  }
}
```

The converter must auto-detect: if input starts with `{` and contains a `"jest"` key, extract that section and treat it as the source config. Otherwise, treat the input as a `jest.config.*` file directly. Provide a tab or auto-switch in the UI.

***
## Behavioral Differences That Need In-UI Warnings
Beyond config key translation, several behavioral differences silently break tests after migration. The converter must surface these as warnings, not just omit the fields:

### 1. `vi.mock` vs `jest.mock` — Hoisting Difference
`jest.mock` is always hoisted to the top of the file. `vi.mock` is also hoisted by Vitest, **but** variables used inside the factory must be prefixed with `mock` or declared inside the factory to avoid "cannot access before initialization" errors. If the input config suggests heavy mocking (custom `__mocks__` dirs, `automock: true`), surface this warning.[25][26]

### 2. `__mocks__` Directory Not Auto-Loaded
Jest auto-loads `__mocks__` files for node_modules. Vitest does not. These must be explicitly called with `vi.mock()` or added to `setupFiles`.[13][8][27]

### 3. `mockReset` Behavior Change
`jest.mockReset()` replaces implementation with `() => undefined`. `vi.mockReset()` resets to the **original implementation**. Any test relying on `mockReset` followed by checking `undefined` return values will break silently.[8]

### 4. Hook Execution Order
Jest runs hooks sequentially. Vitest runs them in stack order by default. To restore Jest behavior: `sequence: { hooks: 'list' }` must be added to config.[8]

### 5. `done` Callback Pattern Removed
Vitest does not support `it('name', (done) => { done() })` — tests must use async/await or return a Promise. If the converter detects `setupFilesAfterEnv` pointing to a setup file, add a note.[8]

### 6. `expect.getState().currentTestName` Format Change
Jest joins describe + test with a space. Vitest joins with ` > `. Any snapshot or string comparison relying on test names will break.[8]

### 7. Coverage Path Tokens
Jest accepts `<rootDir>/src/**` in `collectCoverageFrom`. Vitest's `coverage.include` requires glob patterns without `<rootDir>` — just `./src/**` or `src/**`. The converter must strip `<rootDir>` tokens and normalize paths.[7]

### 8. `vi.mock` Factory Variable Hoisting
Variables used inside a `vi.mock` factory must start with the `mock` prefix (e.g., `mockUserService`) or be declared inside the factory itself. Otherwise Vitest throws "cannot access before initialization." This trips up devs who copy/paste Jest mock blocks verbatim.

### 9. No `jest` Namespace Types
TypeScript code like `let fn: jest.Mock<Args, Return>` won't compile under Vitest. Replace with `import type { Mock } from 'vitest'` and use `Mock<Args, Return>`. Test files (and their setup files) often have this pattern.

### 10. Snapshot Format Changed
Vitest 1+ uses backtick-string snapshots without the escaped quotes Jest uses. The first Vitest run will register **every existing Jest snapshot as changed** even when output is semantically identical. Critical to surface — users will think their test suite is broken.

### 11. `environment: 'jsdom'` (and `'happy-dom'`) Require Package Install
Unlike Jest, Vitest does not bundle the DOM environment. The output must include an npm install hint when `testEnvironment: 'jsdom'` or `'happy-dom'` is detected.

### 12. `globals: true` Does Not Auto-Cleanup Testing Library DOM
Even with `globals: true` enabled, `cleanup()` from `@testing-library/react` must still be called manually in setupFiles (or via auto-cleanup plugins). The official migration guide explicitly calls this out.

***
## Input Formats the Tool Must Support
Jest configuration lives in more places than just `jest.config.js`. The converter must handle all of:

1. `jest.config.{js,ts,cjs,mjs,cts,mts,json}`
2. `package.json` under the `"jest"` key — extremely common, especially in smaller projects and libraries
3. Configs embedded in larger files like `vue.config.js` (Vue CLI) or `craco.config.js` (CRA overrides) — at minimum, surface a warning if these are detected and ask the user to extract the Jest block

Additionally, configs commonly use wrappers the parser must accept:
- `import type { Config } from 'jest'; const config: Config = { ... }; export default config;`
- `module.exports = { ... } satisfies Config`
- `export default defineConfig({...})` (Jest's own helper)
- `module.exports = async () => ({ ... })` — async exports

***
## Finalized Solution Design

### What the Tool Does
A single-page web tool with two text areas: paste `jest.config.{js,ts,cjs,mjs,json}` (or `package.json` containing a `"jest"` key) on the left, get `vitest.config.ts` on the right. Below the output, a collapsible "Warnings & Manual Steps" section surfaces everything the converter cannot automatically fix. A toggle controls whether output is a standalone `vitest.config.ts` or a `test` block to merge into an existing `vite.config.ts`.

### Parser Approach: Use `@babel/parser`, Not Regex
Earlier drafts of this blueprint suggested a regex + bracket-balanced tokenizer. **Don't.** Real Jest configs include constructs that defeat regex parsing:

- TypeScript type annotations: `const config: Config = { ... } satisfies Config`
- Spread operators: `...require('./jest.base')`
- Computed keys: `` [`${ENV}_setup`]: '...' ``
- Conditionals: `coverage: process.env.CI ? { ... } : false`
- Function calls: `pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>/' })`
- Template literals containing regex strings
- Comments inside the config (line, block, JSDoc)
- Async config: `module.exports = async () => ({ ... })`

A regex tokenizer can handle balanced brackets but has no idea what to do with a function call result. The output will be silently wrong or fail outright.

Use **`@babel/parser`** with `typescript` and `jsx` plugins. It's ~700KB minified / ~200KB gzipped, runs client-side without issue (every TypeScript playground uses it), and is the only parser that handles all valid TS/JS config syntax. Walk the AST, find the exported object literal, convert *static* properties via the field mapping table, and preserve dynamic ones (function calls, conditionals, spreads) as `// MANUAL: <preserved expression>` comments with explicit warnings.

Lighter alternatives fall short: `acorn` doesn't handle TS types, `meriyah` is fast but limited, `oxc-parser` WASM is bigger than Babel and harder to integrate.

The mental model: you're not parsing arbitrary code, you're parsing one specific shape — an object literal exported via `module.exports =` or `export default`. Find that node, walk its properties, transform what you can deterministically, preserve what you can't with a clear warning.

### Output Templates
Two output modes:

**Standalone `vitest.config.ts`** (default when no `vite.config.ts` is detected in input):
```ts
import { defineConfig } from 'vitest/config';
// [VITE PLUGIN IMPORTS IF NEEDED — e.g., vite-tsconfig-paths]

export default defineConfig({
  // [VITE/RESOLVE SECTION IF NEEDED — alias, extensions, plugins]
  test: {
    // [CONVERTED TEST CONFIG FIELDS]
  },
});
```

**Merge-into-Vite mode** (when input includes or alongside a `vite.config.ts`):
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
// [existing plugins...]

export default defineConfig({
  // [existing vite config...]
  test: {
    // [CONVERTED TEST CONFIG FIELDS]
  },
});
```

Detect Vite usage by looking for React/Vue plugin patterns in the original `transform` field, or by accepting a paste of an existing `vite.config.ts` alongside the Jest config.

If `pathsToModuleNameMapper` is detected, add `import tsconfigPaths from 'vite-tsconfig-paths'` and `plugins: [tsconfigPaths()]`. If `preset: 'ts-jest'` is detected, add a prominent inline comment: `// ts-jest removed — Vitest handles TypeScript natively via Vite`.

### Output Should Include a "Next Steps" Block
Devs forget the surrounding migration steps. Append as comments at the bottom of the output:

```ts
// Next steps after migration:
// 1. npm uninstall jest @types/jest ts-jest
// 2. npm install -D vitest @vitest/ui happy-dom (or jsdom)
// 3. Update package.json scripts: "test": "vitest"
// 4. Add to tsconfig.json compilerOptions.types: ["vitest/globals"] (if using globals)
```

Tailor the install list based on what was detected (e.g., add `vite-tsconfig-paths` if `pathsToModuleNameMapper` was present; add `@vitest/coverage-v8` if `coverage` was configured).

### Warning Categories (Shown After Output)
Three tiers of warnings, each with a specific fix suggestion:

**Manual action required:**
- Custom `testEnvironment` file (needs interface change)
- `watchPlugins` (no equivalent)
- `testRunner` override (no equivalent)
- `haste` config (React Native only)
- `resolver` (custom resolver — write a Vite plugin)
- `unmockedModulePathPatterns` (per-test `vi.doUnmock()` calls needed)
- `fakeTimers.legacyFakeTimers: true` (no equivalent)
- `pathsToModuleNameMapper` detected (install `vite-tsconfig-paths`)

**Verify after migration:**
- CSS/image stubs in `moduleNameMapper` (need Vite plugin)
- `transformIgnorePatterns` converted to `server.deps.inline` (verify package names)
- `resetMocks` mapped to `mockReset` (verify mock implementation reset semantics)
- `__mocks__` directory usage (auto-loading disabled in Vitest)
- Hook execution order if `beforeAll`/`afterAll` with teardown
- `coverageThreshold` present (V8 AST remapping in Vitest 4 may shift values)
- `maxWorkers: 1` (paired with `isolate: false` to avoid 2× slowdown)
- Snapshot regeneration on first run (format change)
- `testRegex` converted to default glob (verify file matching)
- `currentTestName` separator change (` > ` instead of space)

**Informational:**
- `preset: 'ts-jest'` or `'babel-jest'` removed (TypeScript works natively)
- `transform` entries removed (Vite handles transformation)
- `collectCoverage` removed (use `--coverage` CLI flag instead)
- `extensionsToTreatAsEsm` removed (Vitest handles ESM natively)
- `minWorkers` / `poolOptions` removed (Vitest 4)
- `coverage.all` / `coverage.ignoreEmptyLines` removed (Vitest 4)
- `jsdom` / `happy-dom` package install required
- `globals: true` does not auto-cleanup testing-library DOM

### Path Token Normalization
All occurrences of `<rootDir>` in values must be stripped or replaced with `./` to produce valid Vitest paths.[7][5]

### `moduleNameMapper` Split Logic
The converter must classify each `moduleNameMapper` entry:

1. **Path alias** — pattern like `'^@/(.*)$': '<rootDir>/src/$1'` → extract to `resolve.alias: { '@': './src' }`
2. **Package redirect** — pattern like `'^lodash$': 'lodash-es'` → `resolve.alias: { lodash: 'lodash-es' }`
3. **File stub** — pattern matching static file extensions (`.css`, `.svg`, `.png`, `.jpg`, `.less`, `.scss`, `.gif`, `.woff`, etc.) → cannot auto-convert; emit as warning with suggestion to use `css: false` (for CSS) or `vite-plugin-svgr` (for SVG) or `assetsPlugin()`
4. **Function call** (e.g. `pathsToModuleNameMapper`) — detect by callee name; emit `vite-tsconfig-paths` plugin import + setup; do not attempt to expand

### Monorepo Detection
If the config contains `preset` referencing a relative path (e.g., `'../../jest.preset.js'`), `projects` array, or `displayName`, the tool should surface a monorepo-specific panel explaining:
- `displayName` → `test.name` in Vitest projects
- Shared preset pattern → `mergeConfig()` from `vitest/config`
- Vitest 4 requires `test.projects` declared **inline** in the root `vitest.config.ts` — do not emit a separate workspace file[8][14][16]

### TypeScript Output
Always emit `vitest.config.ts`, not `.js`. Use `import` not `require`. Use `defineConfig` wrapper for type safety. This matches 100% of real-world developer expectations based on migration guide examples.[1][19][5]

***
## Build Plan & Quality Strategy
A credible v1 — one developers will trust enough to commit the output — is roughly **2 weeks of work**, not 1–3 days. The shorter estimate gets you a demo, not a tool you'd put your domain reputation behind.

- **Day 1–3:** AST parsing setup with `@babel/parser`, basic field mapping table, direct renames
- **Day 4–6:** `moduleNameMapper` split logic, `<rootDir>` normalization, coverage restructure
- **Day 7–9:** Warning system, `transformIgnorePatterns` → `server.deps.inline`, monorepo handling
- **Day 10–12:** Edge cases — `pathsToModuleNameMapper` detection, `package.json` input, `vite.config.ts` merge mode
- **Day 13–14:** Test suite using real Jest configs scraped from popular OSS repos

**Concrete quality lever:** maintain a `fixtures/` directory with 50+ real-world `jest.config.js` files scraped from popular GitHub projects. Use the GitHub search API to find repos with **both** `jest.config.js` and `vitest.config.ts` in their history — those are post-migration projects whose configs you can use as ground-truth pairs. Run the converter against the Jest input, diff against the human-migrated Vitest output, and use that as the regression suite. This builds trust faster than reading docs and guessing.

***
## Scope Boundaries
The tool converts **`jest.config.*` (and `package.json` `"jest"` blocks) only**. It explicitly does not convert:
- Individual test files (`.spec.ts`, `.test.ts`) — codemods handle this
- `package.json` test scripts — shown as a suggestion in the next-steps panel
- `tsconfig.json` type references (adding `"vitest/globals"` to types) — shown as a separate note

This scope is the tool's competitive moat: codemods exist for test files, but nothing exists for configs.
