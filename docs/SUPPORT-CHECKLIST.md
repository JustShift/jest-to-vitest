# Converter Support Checklist

This checklist audits `src/lib/converter.ts` against:

- `instructions/PROBLEM GUIDE.md`
- `instructions/CODEBASE_ANALYSIS.md`
- The current converter implementation

Legend:

- `[x] Supported` means the converter implements the guide requirement in a basically usable way.
- `[~] Partial` means the converter handles a common case, but misses guide details or edge cases.
- `[ ] Unsupported` means the guide calls for it, but the converter does not implement it.
- `[!] Broken/Buggy` means the converter emits incorrect output, silently loses behavior, or maps to the wrong config shape.

## Overall Status

- `[x] Supported` Core AST-based conversion using Babel parser/traverse/generator with `typescript` and `jsx` plugins.
- `[x] Supported` Standalone `vitest.config.ts` output using `import { defineConfig } from 'vitest/config'`.
- `[x] Supported` Merge-into-Vite output mode at the API level (`OutputMode = 'standalone' | 'merge'`).
- `[x] Supported` Warning model with `manual`, `verify`, and `info` categories plus deduplication.
- `[x] Supported` Output assembly via keyed `Map`s — duplicate output keys are merged, not silently overwritten.
- `[x] Supported` Tailored "Next steps" output based on detected features.
- `[x] Supported` Field mapping coverage and behavioral migration warnings (vi.mock hoisting, hook order, done callback, currentTestName separator, framework-specific snapshot warnings, no-jest-namespace warning).
- `[x] Supported` UI toggle for standalone vs merge output mode.
- `[x] Supported` Fixture-based regression test suite (`tests/converter.test.ts`, `tests/code-highlight.test.ts`, `tests/converter-client.test.ts`, run with `npm test`).

## Input And Parser Support

- `[x] Supported` `package.json` with a top-level `"jest"` key is detected and extracted.
- `[x] Supported` Plain `jest.config.json` object input is treated as a Jest config when no top-level `"jest"` key exists.
- `[x] Supported` `module.exports = { ... }`.
- `[x] Supported` `export default { ... }`.
- `[x] Supported` `module.exports = defineConfig({ ... })` or similar first-argument object wrappers.
- `[x] Supported` `export default defineConfig({ ... })` or similar first-argument object wrappers.
- `[x] Supported` Wrapper calls whose argument is an identifier, e.g. the standard `next/jest` shape `module.exports = createJestConfig(customJestConfig)`. The identifier is resolved through its binding, same as `module.exports = config`. When the wrapper is detected as `next/jest` (import or require, `.js` suffix included), the output adds `@vitejs/plugin-react` and `vite-tsconfig-paths` plus a verify warning about what the SWC preset handled implicitly.
- `[x] Supported` TypeScript syntax via Babel's `typescript` plugin.
- `[x] Supported` JSX syntax via Babel's `jsx` plugin.
- `[x] Supported` `const config: Config = { ... }; export default config;` (resolved via scope binding lookup).
- `[x] Supported` `const config = { ... }; module.exports = config;` (resolved via scope binding lookup).
- `[x] Supported` `module.exports = { ... } satisfies Config` and `as Config` are unwrapped before extraction.
- `[x] Supported` Spread elements such as `...require('./jest.base')` are preserved as `// MANUAL:` comments with manual warnings.
- `[x] Supported` Object methods are preserved as `// MANUAL:` comments with manual warnings.
- `[x] Supported` Computed keys are preserved as `// MANUAL:` comments with manual warnings.
- `[x] Supported` `module.exports = async () => ({ ... })` — body's static return value is extracted; a verify warning notes that any non-static logic was dropped.
- `[x] Supported` `module.exports = () => ({ ... })` and `module.exports = function() { return {...}; }` — same handling.
- `[x] Supported` Configs embedded in `vue.config.js`, `craco.config.js`, or any parent config with a `jest:` key — extraction picks up the `jest` block, `flags.embeddedParent` indicates which parent was detected, and a verify warning fires.

## Output Template Support

- `[x] Supported` Emits `vitest.config.ts`-style TypeScript output.
- `[x] Supported` Uses `defineConfig`.
- `[x] Supported` Uses ESM imports instead of `require`.
- `[x] Supported` Adds plugin import/output for `vite-tsconfig-paths` when `pathsToModuleNameMapper` is detected.
- `[x] Supported` Tailored "Next steps after migration" block adapts to detected features (jsdom, happy-dom, vite-tsconfig-paths, coverage, globals, monorepo).
- `[x] Supported` Merge-into-Vite mode at the converter API: emits `/// <reference types="vitest/config" />` and imports from `'vite'`.
- `[x] Supported` Root-level Vite sections (`plugins`, `define`, `resolve.alias`, `resolve.extensions`, `test`) are modeled as separate output sections, preventing cross-section pollution.
- `[x] Supported` UI toggle for standalone vs merge mode (segmented control in the output pane header).
- `[~] Partial` Inline comment near removed `ts-jest` transform output: a summary `info` warning is emitted but no inline comment in the output.

## Core Test Discovery Fields

- `[x] Supported` `testMatch` -> `test.include`.
- `[~] Partial` `testPathIgnorePatterns` -> `test.exclude` for safe path-like entries; regex-like entries are preserved as manual comments because Vitest expects globs.
- `[x] Supported` `testEnvironment` -> `test.environment` with file-path vs package-name classification and known package-name normalization (`jest-environment-jsdom` -> `jsdom`, `jest-environment-node` -> `node`).
- `[x] Supported` `testEnvironmentOptions` -> `test.environmentOptions`, nested under the resolved environment name (`{ jsdom: { ... } }`, `{ happyDOM: { ... } }`) regardless of key order, at the root and inside `projects` entries. `customExportConditions` is dropped with a manual warning (no Vitest equivalent; the MSW workaround is unnecessary under Vitest). Environments that take no options (node, custom) keep the object as a `// MANUAL:` comment.
- `[x] Supported` `testTimeout` -> `test.testTimeout`.
- `[x] Supported` `slowTestThreshold` -> `test.slowTestThreshold` with Jest seconds converted to Vitest milliseconds.
- `[x] Supported` `bail` -> `test.bail`, with `true` normalized to `1`.
- `[x] Supported` `maxConcurrency` -> `test.maxConcurrency`.
- `[x] Supported` `verbose` -> `test.reporters`.
- `[x] Supported` `extensionsToTreatAsEsm` is dropped with info warning.
- `[x] Supported` `errorOnDeprecated` is dropped with info warning.
- `[x] Supported` `testFailureExitCode` is dropped with info warning.
- `[x] Supported` `notify` / `notifyMode` are dropped with info warning.
- `[x] Supported` `sandboxInjectedGlobals` is dropped with info warning.
- `[x] Supported` `testRegex` -> equivalent glob(s) for translatable patterns (simple suffix matchers like `\.test\.tsx?$`, `__tests__/` directory matchers, extension alternates `[jt]sx?`/`(js|jsx|ts|tsx)`, and the classic Jest/CRA default `(/__tests__/.*|(\.|/)(test|spec))\.[jt]sx?$`), with a verify warning. Untranslatable patterns (lookarounds, quantified groups, residual regex syntax) fall back to the default Vitest glob with a verify warning, at the root and inside `projects` entries.
- `[x] Supported` `testPathDirs` (deprecated Jest name for `roots`) is treated as `roots` with an info warning about the deprecation.
- `[x] Supported` `setupTestFrameworkScriptFile` (deprecated Jest name for `setupFilesAfterEnv`) is treated as `setupFilesAfterEnv` (including the ordering verify warning) with an info warning about the deprecation.
- `[~] Partial` `roots` -> `test.dir`, but only the first array item is used (with an info warning when multiple are present).

## Module Resolution Fields

- `[x] Supported` Simple `moduleNameMapper` path aliases map to `resolve.alias`.
- `[x] Supported` Package redirects like `'^lodash$': 'lodash-es'` map to `resolve.alias`.
- `[x] Supported` `moduleNameMapper: pathsToModuleNameMapper(...)` triggers `vite-tsconfig-paths` plugin output and tailored install step.
- `[x] Supported` Relative aliases are rewritten with `path.resolve(__dirname, ...)` and `import path from 'node:path'` is auto-added.
- `[x] Supported` CSS file stubs are detected and emit `test.css: false` with a verify warning.
- `[x] Supported` Image/asset stubs detected across `gif|png|jpg|jpeg|svg|webp|avif|ico` (including single-extension keys like `\.svg$`) with verify warning.
- `[x] Supported` SVG stubs whose **target** is an SVG-to-component transformer (`@svgr/*`, `jest-svg-transformer`) emit `import svgr from 'vite-plugin-svgr'` + `plugins: [svgr()]` + tailored install step, and set the `needsSvgr` flag. SVG keys mapped to generic stubs (`fileMock.js`, `identity-obj-proxy`, a plain string) get a verify warning only — no svgr, no `?react` rewrite.
- `[x] Supported` Font stubs detected across `woff|woff2|eot|ttf|otf` with info warning.
- `[x] Supported` Alias cleanup handles `^@/(.*)$` and `<rootDir>/src/$1` patterns.
- `[x] Supported` `moduleDirectories` -> `test.deps.moduleDirectories` with verify warning explaining source-vs-mock distinction.
- `[x] Supported` `modulePaths` emits manual warning explaining the source-aliasing vs dependency-resolution distinction.
- `[x] Supported` `moduleFileExtensions` -> `resolve.extensions` (separate from `resolve.alias`).
- `[x] Supported` `resolver` emits manual warning.
- `[x] Supported` `unmockedModulePathPatterns` emits manual warning.
- `[x] Supported` Plugin output (`vite-plugin-svgr` import + plugin + install step) for SVG keys whose target is an SVG-to-component transformer.

## Setup And Teardown Fields

- `[x] Supported` `setupFiles` -> `test.setupFiles`.
- `[x] Supported` `setupFilesAfterEnv` -> `test.setupFiles`.
- `[x] Supported` `setupFiles` and `setupFilesAfterEnv` from the same input merge into one `test.setupFiles` array.
- `[x] Supported` `setupFilesAfterEnv` semantic difference is surfaced as a verify warning.
- `[x] Supported` `globalSetup` -> `test.globalSetup`, with CommonJS-extension (`.js`/`.cjs`) detection emitting a verify warning and inline `// VERIFY:` comment about Vitest's ESM default-export requirement.
- `[x] Supported` `globalTeardown` is preserved as a `// MANUAL:` comment with a manual warning; no invalid `test.globalTeardown` key is emitted.
- `[x] Supported` `done` callback info warning emitted when `setupFilesAfterEnv` is present (legacy setup pattern).

## Coverage Fields

- `[x] Supported` `collectCoverage: true/false` -> `test.coverage.enabled`.
- `[x] Supported` `collectCoverageFrom` -> `test.coverage.include`, with negated entries split into `test.coverage.exclude`.
- `[x] Supported` `coverageDirectory` -> `test.coverage.reportsDirectory`.
- `[x] Supported` `coverageReporters` -> `test.coverage.reporter`.
- `[x] Supported` `coverageThreshold` -> `test.coverage.thresholds` with Jest `global` unwrapped to direct threshold keys and verify warnings for V8 AST remapping/path-threshold semantics.
- `[~] Partial` `coveragePathIgnorePatterns` -> `test.coverage.exclude` for safe path-like entries; regex-like entries are preserved as manual comments because Vitest expects globs.
- `[x] Supported` `forceCoverageMatch` -> `test.coverage.include` (merges with `collectCoverageFrom` instead of duplicating).
- `[x] Supported` `coverageProvider` -> `test.coverage.provider`, including `babel` -> `istanbul` normalization and manual warning for invalid providers.
- `[x] Supported` Tailored next step installs the provider that matches detected coverage config (`@vitest/coverage-v8` or `@vitest/coverage-istanbul`).
- `[x] Supported` `coverage.all` carryover from Vitest 3 emits info warning about Vitest 4 removal.
- `[x] Supported` `coverage.ignoreEmptyLines` carryover emits info warning about Vitest 4 removal.
- `[x] Supported` `<rootDir>` is normalized position-aware (`normalizeRootDir`): leading `<rootDir>/` -> `./`, a bare `<rootDir>` -> `.`, occurrences after a `/` or regex anchor collapse, mid-string occurrences keep a single separator. Package names and strings without the token are untouched.

## Transform And Compilation Fields

- `[x] Supported` `preset: 'ts-jest'` is removed with info warning.
- `[x] Supported` `preset: 'babel-jest'` is removed with info warning.
- `[x] Supported` Custom `preset` emits manual warning.
- `[x] Supported` Relative `preset` paths emit manual warning with `mergeConfig()` guidance and flag the input as a monorepo signal.
- `[x] Supported` `transform` entries are classified per-entry: `ts-jest`/`babel-jest`/`@swc/jest` are dropped with a summary info warning (Vite handles the transform natively); `@vue/vue3-jest`/`vue-jest` and `svelte-jester` emit concrete plugin suggestions (`@vitejs/plugin-vue`, `@sveltejs/vite-plugin-svelte`) as verify warnings; file-stub transformers (`jest-transform-stub`, `jest-svg-transformer`, etc.) emit verify warnings; custom transformers emit manual warnings.
- `[x] Supported` `transformIgnorePatterns` extracts package names into `test.server.deps.inline` from plain, capturing, and non-capturing group shapes (`(?!pkg|other)`, `(?!(pkg|other)/)`, `(?!(?:pkg|other)/)`), including scoped packages, escaped dots/slashes, and pnpm-style chained lookaheads (`(?!.pnpm)(?!(...))`, with `.pnpm` itself excluded as a directory artifact). Items that still carry regex syntax (e.g. `(jest-)?react-native`) are skipped so the could-not-parse verify warning fires instead of emitting garbage names.

## Mocking Behavior Fields

- `[x] Supported` `clearMocks` -> `test.clearMocks`.
- `[x] Supported` `resetMocks` -> `test.mockReset` with verify warning about behavioral difference.
- `[x] Supported` `restoreMocks` -> `test.restoreMocks`.
- `[x] Supported` `automock: true` emits manual warning explaining Vitest's `__mocks__`-only behavior; `automock: false` no longer emits `automock: true`.
- `[x] Supported` `fakeTimers.legacyFakeTimers` emits manual warning.
- `[x] Supported` `fakeTimers.enableGlobally: false` is honored — output omits a global fake-timer install.
- `[x] Supported` `fakeTimers.enableGlobally: true` emits a manual warning; no invalid `install: true` output is emitted.
- `[x] Supported` `fakeTimers` object without unsupported keys copies only valid Vitest fake-timer options.
- `[x] Supported` `timers: 'legacy'` and `timers: 'fake'` emit warnings; no invalid fake-timer install config is emitted.
- `[x] Supported` `vi.mock` factory hoisting verify warning emitted whenever any mocking-related field is present (automock, clearMocks, resetMocks, restoreMocks, unmockedModulePathPatterns).
- `[x] Supported` No `jest` namespace types info warning emitted when `globals: true` is set or the input looks like TypeScript (`satisfies`/`as Config`/`: Config`).
- `[~] Partial` `__mocks__` warning is currently manual-tier; the guide places it at verify-tier.

## Parallelism And Performance Fields

- `[x] Supported` `maxWorkers` -> `test.maxWorkers`.
- `[x] Supported` `maxWorkers: 1` also emits `isolate: false` and verify warning.
- `[x] Supported` `runInBand` -> `maxWorkers: 1, isolate: false`.
- `[x] Supported` `workerThreads: true` (Jest 30) -> `test.pool: 'threads'` with an info warning; `workerThreads: false` is omitted (Vitest's default `forks` pool already uses child processes).
- `[x] Supported` `workerIdleMemoryLimit` -> `vmMemoryLimit`, with an inline `// VERIFY:` note and a verify warning that `vmMemoryLimit` only applies to the non-default `vmThreads` pool.
- `[x] Supported` `minWorkers` is dropped with info warning.
- `[x] Supported` `poolMatchGlobs` and `environmentMatchGlobs` are dropped with info warning.
- `[x] Supported` `testSequencer` is preserved as a `// MANUAL:` comment with manual warning about Vitest sequencer interface differences.
- `[x] Supported` `randomize` -> `test.sequence.shuffle` for static boolean values.
- `[x] Supported` `showSeed` emits guidance to verify Vitest seed/sequence behavior.
- `[x] Supported` `detectOpenHandles` / `detectLeaks` emit verify warning with `--logHeapUsage` and verbose-reporter guidance.
- `[x] Supported` `poolOptions` removal handling — emits info warning.
- `[x] Supported` `poolOptions.threads.singleThread: true` -> `maxWorkers: 1` plus `isolate: false`.
- `[x] Supported` `poolOptions.forks.singleFork: true` -> `maxWorkers: 1` plus `isolate: false`.

## Reporters And Output Fields

- `[x] Supported` `verbose: true` -> `reporters: ['verbose']`.
- `[x] Supported` `verbose: false` -> `reporters: ['default']`.
- `[x] Supported` `silent` -> `test.silent`.
- `[x] Supported` `jest-junit` (bare or `['jest-junit', { outputDirectory, outputName, outputFile }]`) maps to Vitest's built-in `['junit', { outputFile }]`; unmappable jest-junit options emit a verify warning, dynamic option objects are copied verbatim with a verify warning.
- `[x] Supported` `github-actions` maps to Vitest's built-in `'github-actions'` reporter (options dropped with an info note).
- `[x] Supported` Remaining reporters are copied verbatim; the verify warning fires only when a copied name is not a Vitest built-in (`default`, `verbose`, `dot`, `json`, `junit`, `tap`, `tap-flat`, `html`, `hanging-process`, `github-actions`).
- `[x] Supported` `verbose` and `reporters` together merge into a single `test.reporters` array instead of producing duplicate keys.

## Snapshot Fields

- `[x] Supported` `snapshotSerializers` -> `test.snapshotSerializers`.
- `[x] Supported` `snapshotFormat` -> `test.snapshotFormat`, with verify warning only for unsupported formatter/plugin values.
- `[x] Supported` `prettierPath` emits info warning explaining Vitest's internal serializer.
- `[x] Supported` Generic snapshot regeneration warning is always emitted.
- `[x] Supported` Vue/React snapshot serializer output difference verify warning emitted when known framework serializers (`enzyme-to-json`, `jest-serializer-vue`, `@vue/test-utils`, `@emotion/jest`, etc.) appear in `snapshotSerializers`.
- `[x] Supported` `expect.getState().currentTestName` separator info warning emitted on every conversion.

## Watch Fields

- `[x] Supported` `watchPlugins` emits manual warning.
- `[x] Supported` `watchPathIgnorePatterns` with static string patterns emits the actual root-level `server.watch.ignored` block (globs anchored with `**/`); regex/dynamic entries fall back to a manual warning.

## Multi-Project And Monorepo Fields

- `[x] Supported` `projects` -> `test.projects`: each static project object is remapped to Vitest's `{ test: { ... } }` shape (`displayName` -> `name`, `testMatch` -> `include`, `testEnvironment` -> `environment` with normalization, `setupFiles`/`setupFilesAfterEnv`, `testPathIgnorePatterns` -> `exclude`, `roots` -> `dir`, plus direct scalars like `testTimeout`). Glob string entries pass through with `<rootDir>` normalized. Unmappable project fields become `// MANUAL:` comments with per-project warnings; a verify warning notes that neither runner inherits root options without `extends: true`.
- `[x] Supported` `displayName` -> `test.name`.
- `[x] Supported` `projects` warning mentions Vitest 4 inline workspace requirement.
- `[x] Supported` Relative shared `preset` paths flag the input as a monorepo signal and emit `mergeConfig()` guidance.
- `[x] Supported` Tailored next step: "Monorepo detected: share config via mergeConfig() from 'vitest/config' instead of preset paths" appears when monorepo signals are detected.
- `[x] Supported` Dedicated monorepo-specific UI panel (rendered when `flags.monorepo` is true).

## Globals Fields

- `[x] Supported` `injectGlobals: true` -> `test.globals: true`; `injectGlobals: false` is omitted with an info warning because explicit imports are Vitest's default.
- `[x] Supported` `globals: true` -> `test.globals: true`.
- `[x] Supported` Object `globals` with the `'ts-jest'` key stripped, remaining entries moved to root-level Vite `define`.
- `[x] Supported` Manual warning explaining Jest `globals` vs Vitest `globals: true` semantic difference.
- `[x] Supported` Tailored next-step note for `compilerOptions.types: ['vitest/globals']` when `globals: true` is used.
- `[x] Supported` Info warning that `globals: true` does not auto-cleanup Testing Library DOM.

## No-Equivalent And Removed Fields

- `[x] Supported` `watchPlugins` emits manual warning.
- `[x] Supported` `testRunner` emits manual warning.
- `[x] Supported` `dependencyExtractor` emits manual warning.
- `[x] Supported` `haste` emits manual warning.
- `[x] Supported` `resolver` emits manual warning.
- `[x] Supported` `unmockedModulePathPatterns` emits manual warning.
- `[x] Supported` `modulePathIgnorePatterns` emits manual warning.
- `[x] Supported` `resetModules` emits behavioral review warning for `vi.resetModules()` / module isolation.
- `[x] Supported` `snapshotResolver` emits manual warning and `resolveSnapshotPath` guidance.
- `[x] Supported` `testResultsProcessor` emits manual warning to replace with a Vitest reporter or post-processing step.
- `[x] Supported` `waitForUnhandledRejections` emits verify warning about Vitest unhandled-rejection semantics.
- `[x] Supported` `extensionsToTreatAsEsm` emits info warning.
- `[x] Supported` `errorOnDeprecated` emits info warning.
- `[x] Supported` `testFailureExitCode` emits info warning.
- `[x] Supported` `notify` / `notifyMode` emit info warning.
- `[x] Supported` `sandboxInjectedGlobals` emits info warning.
- `[x] Supported` `testURL` -> `environmentOptions: { jsdom: { url } }`.
- `[x] Supported` `coverage.all` carryover removal info warning.
- `[x] Supported` `coverage.ignoreEmptyLines` carryover removal info warning.
- `[x] Supported` `poolOptions` removal handling.

## Path Normalization

- `[x] Supported` Path-aware `<rootDir>` normalizer (`normalizeRootDir`, exported): leading `<rootDir>/` -> `./`, a bare `<rootDir>` -> `.`, occurrences after `/` or regex anchors (`^`, `(`, `|`) collapse, mid-string occurrences keep a single separator. The code-level variant (`normalizeRootDirInCode`) applies the same rules using the preceding quote character as string-start context.
- `[x] Supported` Relative file aliases are rewritten with `path.resolve(__dirname, ...)` for stable Vite resolution.
- `[x] Supported` Package names and strings without the token are untouched; globs keep their (valid) `./` prefix.

## Warning Categories And UI

- `[x] Supported` Manual warning category exists.
- `[x] Supported` Verify warning category exists.
- `[x] Supported` Info warning category exists.
- `[x] Supported` UI displays warning counts and grouped warning lists.
- `[x] Supported` Warnings are deduplicated by `(type, message)` key.
- `[~] Partial` Warning copy is mostly specific and actionable; some still benefit from concrete fix examples.
- `[x] Supported` Collapsible warning/manual-steps panel (chevron toggle in the panel header).
- `[x] Supported` Monorepo-specific warning panel (auto-shows when `flags.monorepo` is true).
- `[x] Supported` Hook execution order info warning emitted when setup files or global hooks are present.
- `[x] Supported` `done` callback warning emitted when legacy setup signal is detected.
- `[x] Supported` Current test name separator warning emitted on every conversion.
- `[x] Supported` `vi.mock` factory variable hoisting warning emitted when mocking signal is detected.

## Use Case Checklist From The Guide

- `[x] Supported` Use Case 1: Simple React App. CSS stub mapped, asset stub classification works, tailored next steps include jsdom + coverage installs.
- `[x] Supported` Use Case 2: TypeScript Project with `ts-jest`. `preset: 'ts-jest'` removed, transform entries classified, tailored next steps include uninstall step.
- `[x] Supported` Use Case 3: Complex React Project with Many Transformers. `transformIgnorePatterns` extracts package names into `test.server.deps.inline`; transform entries are classified per-entry.
- `[x] Supported` Use Case 4: TypeScript Project Using `pathsToModuleNameMapper`. Detects helper, emits `vite-tsconfig-paths`, and adds the install step to tailored next steps.
- `[x] Supported` Use Case 5: Monorepo / Nx Workspace. Field mappings, tailored monorepo next step, and a dedicated UI panel that auto-shows when `flags.monorepo` is true.
- `[x] Supported` Use Case 6: Projects Using `globals` Object. Object globals move to root-level `define`; `'ts-jest'` is stripped; `globals: true` semantic-difference warning is surfaced.
- `[x] Supported` Use Case 7: Fake Timers And Legacy Timer Config. `fakeTimers.legacyFakeTimers` warned, `fakeTimers.enableGlobally` handled without invalid `install: true`, and legacy/fake `timers` values warned.
- `[x] Supported` Use Case 8: Custom Test Environments. Custom file-path vs package-name classification, `testURL` → `environmentOptions.jsdom.url`.
- `[x] Supported` Use Case 9: Snapshot Serializers. `snapshotSerializers` and `snapshotFormat` mapped to valid Vitest keys; framework-specific verify warning fires when `enzyme-to-json`, `jest-serializer-vue`, `@vue/test-utils`, `@emotion/jest`, etc. are detected.
- `[x] Supported` Use Case 10: Configs Living In `package.json`. Top-level `"jest"` extraction is implemented.

## Quality Gates

- `[x] Supported` TypeScript compiler currently passes with `npx tsc --noEmit`.
- `[x] Supported` `npm test` runs 76 Vitest cases across converter fixtures plus editor-highlighter and browser-worker hardening tests.
- `[x] Supported` `npm run lint` passes (0 errors, 0 warnings).
- `[x] Supported` `npm run build` succeeds offline. `next/font/google` was removed from `src/app/layout.tsx`; the body uses the system font stacks defined in `globals.css`.
- `[x] Supported` Editor syntax highlighting renders React text nodes instead of `dangerouslySetInnerHTML` for pasted converter input.
- `[x] Supported` Browser conversion has input byte/line limits, worker timeout handling, and pending request cleanup on worker failure.
- `[x] Supported` Baseline security headers include CSP, frame/object restrictions, referrer policy, content-type nosniff, and a minimal permissions policy.
- `[x] Supported` `npm audit --audit-level=moderate` passes after forcing patched `postcss` through npm `overrides`.

## Highest Priority Fix Checklist

- `[x] Supported` Add converter unit tests before expanding behavior further.
- `[~] Partial` Create guide-based fixtures for the ten documented use cases. 4 of 10 are explicit; the remaining 6 are covered indirectly via the input-shape, output-shape, and behavioral-warning suites.
- `[x] Supported` Wire UI to forward `{ mode }` to `convertConfigAction` and add a standalone/merge toggle.
- `[x] Supported` Fix lint failures (`actions.ts` `any`, `page.tsx` set-state-in-effect, unused imports/params).
- `[x] Supported` Add behavioral migration warnings: `vi.mock` hoisting, hook order, `done` callback, `currentTestName` separator, framework snapshot warnings, no-`jest`-namespace.
- `[x] Supported` Add UI affordances: collapsible warnings panel, monorepo-specific panel, embedded-config detection (the `vue.config`/`craco.config` `jest:` block is auto-extracted and `flags.embeddedParent` drives a verify warning).
- `[x] Supported` Support remaining input shapes: `() => ({...})`, `async () => ({...})`, `function() { return {...}; }`, embedded `vue.config.js` / `craco.config.js`.
- `[x] Supported` Replace or localize Google fonts (removed `next/font/google` entirely; CSS already uses a system font stack).

## Remaining Backlog (Lower Priority)

- `[~] Partial` `__mocks__` warning is currently manual-tier; the guide places it at verify-tier.
- `[~] Partial` Extend `tests/converter.test.ts` with the remaining six PROBLEM GUIDE use cases as standalone fixture-based tests. (Real-world fixtures are done: `tests/fixtures/` covers Next.js, Nx, CRA, Remix, T3, Vue + craco, and a Vite + jest hybrid, snapshot-tested in `tests/fixtures.test.ts`.)

## 2026-06-13 additions

- `[x] Supported` Stable warning codes: every `Warning` carries a `code` field (e.g. `discovery.testRegex`, `resolve.aliasRegex`, `mocks.hoisting`), aligned with the `@shiftkit/webpack-to-vite` warning model; the CLI prints `[tier] (code) message`.
- `[x] Supported` Multi-statement static evaluation: `const config = {...}; config.x = y; module.exports = config` (module level, via binding reference paths) and `module.exports = () => { const config = {...}; config.x = y; return config; }` (function bodies, syntactic) fold member assignments into the config object; later assignments win; if-guarded assignments fold unconditionally with a callout in the `config.multiStatement` verify warning. No user code is ever executed.
- `[x] Supported` Non-trivial `moduleNameMapper` keys (mid-string capture groups) emit Vite's array-form regex alias `{ find: /regex/, replacement: '...$1' }` with a verify warning; the alias block switches to array form only when regex entries exist.
- `[x] Supported` `testEnvironment: '@happy-dom/jest-environment'` is normalized to `'happy-dom'` (sets `needsHappyDom`), alongside the existing `jest-environment-jsdom`/`jest-environment-node` normalization.
- `[x] Supported` Package-manager-aware next steps: `ConvertOptions.packageManager` (`npm` default for the web/API path); the CLI detects `pnpm-lock.yaml`/`yarn.lock`/`bun.lockb` and accepts `--pm` to override. Uninstall/install commands and the post-apply hint all follow the selected manager.
- `[x] Supported` `--target-vitest 3|4` (API: `ConvertOptions.targetVitest`): 3 emits the `test.workspace` key instead of inline `projects`, passes `poolOptions` through verbatim, and pins install commands/`--apply` ranges to `@^3`. 4 (default) keeps the Vitest-4-first output.
- `[x] Supported` `--apply` rewrites `'@testing-library/jest-dom'` (and `/extend-expect`) imports to `'@testing-library/jest-dom/vitest'` in detected setup files (`flags.setupFiles`), behind the existing dirty-tree guard.
- `[x] Supported` No-`eval` source gate test (`tests/no-eval.test.ts`): the converter source must never contain `eval(`, `new Function`, or `vm.runInContext` (mirrors webpack-to-vite; the ShiftKit production CSP omits `'unsafe-eval'`).
- `[x] Supported` Real-world fixture suite: `tests/fixtures/` + `tests/fixtures.test.ts` snapshot the full output, warning report, and flags for Next.js, Nx, CRA (package.json#jest), Remix, T3, Vue + craco, and Vite + jest hybrid configs, and assert determinism + parseable TypeScript output.

## CLI surface

- `[x] Supported` `--apply` mode auto-detects jest.config.{ts,mts,cts,js,mjs,cjs,json} or package.json#jest, writes vitest.config.ts, updates package.json devDependencies and scripts.
- `[x] Supported` `--apply` refuses to run on a dirty git tree (override with `--force`).
- `[x] Supported` `--apply` refuses to run outside a git repo (override with `--force`).
- `[x] Supported` `--apply --delete-old` removes the original jest.config file after successful conversion.
- `[x] Supported` `--apply` refuses to overwrite an existing vitest.config.ts (override with `--force`).
- `[x] Supported` `--json` emits the conversion (or apply) result as JSON for CI integration.
- `[x] Supported` `--no-format` disables output pretty-printing (escape hatch).
- `[x] Supported` `--strict` exits non-zero when any manual-tier warning is emitted.
- `[x] Supported` `--pm npm|pnpm|yarn|bun` overrides the lockfile-detected package manager used in next-steps commands and the post-apply hint.
- `[x] Supported` `--target-vitest 3|4` selects the output target (workspace key + poolOptions passthrough + `@^3` ranges for 3).
- `[x] Supported` `--apply` rewrites the `@testing-library/jest-dom` import to `/vitest` in detected setup files and reports the touched files (also in `--json` as `setupFilesRewritten`).
- `[x] Supported` GitHub Action (`action.yml` at repo root) wraps the CLI; exposes `output-file`, `warning-count`, `manual-count`, `json` outputs.

## Output formatting

- `[x] Supported` Custom AST-based pretty-printer for multi-line arrays and nested objects (no `prettier` dependency).
- `[x] Supported` Single-quote normalization for string literals and object keys.
- `[x] Supported` Inline `// VERIFY:` / `// MANUAL:` comments attached to field-tied warnings (`mockReset`, `setupFiles`, `reporters`, `deps`, `thresholds`, `environmentOptions`, `globalSetup`, `include` from testRegex).
- `[x] Supported` `format: false` option in the programmatic API and `--no-format` flag in the CLI for raw babel-generator output.

## Current Classification

The converter should currently be classified as:

```text
Guide-complete v1
```

To reach:

```text
Production-trustworthy migration tool
```

…the remaining work is real-world coverage rather than core mapping. Specifically: a wider regression suite of real-world Jest configs, plugin-output for file stubs, and a path-aware normalizer that distinguishes globs from file paths from package names.

## Sources Checked

These sources were used to verify checklist items against current official docs:

- Vitest config overview: https://vitest.dev/config/
- Vitest `server.deps.inline`: https://vitest.dev/config/server
- Vitest dependency options and `deps.moduleDirectories`: https://vitest.dev/config/deps
- Vitest coverage options: https://vitest.dev/config/coverage
- Vitest environment config: https://vitest.dev/config/environment
- Vitest `environmentOptions`: https://vitest.dev/config/environmentoptions
- Vitest snapshot format: https://vitest.dev/config/snapshotformat
- Vitest snapshot serializers: https://vitest.dev/config/snapshotserializers
- Vitest sequence config: https://vitest.dev/config/sequence
- Vitest Jest migration guide: https://vitest.dev/guide/migration.html
- Vitest hooks API: https://vitest.dev/api/hooks.html
- Vite shared options: https://vite.dev/config/shared-options
