# Converter Re-evaluation Findings

Date: 2026-05-05  
Scope: `src/lib/converter.ts`, converter UI/security path, local docs, installed `vitest@4.1.5` types, and current official Jest/Vitest docs.

This file is the working checklist for tightening the Jest-to-Vitest converter after re-checking earlier findings. Treat these items as source-of-truth until each item is either fixed, tested, or intentionally deferred.

## Verified Sources

- Vitest config overview: https://vitest.dev/config/
- Vitest `mockReset`: https://vitest.dev/config/mockreset
- Vitest `fakeTimers`: https://vitest.dev/config/faketimers
- Vitest `snapshotFormat`: https://vitest.dev/config/snapshotformat
- Vitest `globalSetup`: https://vitest.dev/config/globalsetup
- Vitest coverage config: https://vitest.dev/config/coverage
- Vitest sequence config: https://vitest.dev/config/sequence
- Vitest globals config: https://vitest.dev/config/globals
- Vitest bail config: https://vitest.dev/config/bail
- Vitest migration guide: https://vitest.dev/guide/migration.html
- Jest configuration docs: https://jestjs.io/docs/configuration

## Highest Priority Correctness Fixes

- [x] `resetMocks` mapping is wrong.
  - Current code: `resetMocks` emits `test.resetMocks`.
  - Correct Vitest key: `test.mockReset`.
  - Location: `src/lib/converter.ts`, `case 'resetMocks'`.
  - Update tests to assert `mockReset: true` and no `resetMocks:` output.

- [x] `automock` is mapped to unrelated mock reset behavior.
  - Current code emits `mockReset` for boolean `automock`.
  - Vitest has no `automock` config equivalent.
  - Desired behavior: warning-only, likely manual or verify depending on `true`/`false`; do not emit `mockReset`.
  - Also keep the `__mocks__` warning, but classify the auto-loading difference as verify-level unless there is an actual impossible migration.

- [x] `fakeTimers` emits invalid `install: true`.
  - Current code emits `fakeTimers: { install: true }` for `enableGlobally: true` and `timers: 'fake'`.
  - Vitest `fakeTimers` only stores options passed to `vi.useFakeTimers()`.
  - Desired behavior:
    - `enableGlobally: true`: emit a setup-file/manual warning to call `vi.useFakeTimers()` globally if that behavior is truly needed.
    - `enableGlobally: false`: omit with info warning.
    - `legacyFakeTimers: true`: manual warning, no config mapping.
    - Preserve compatible timer options only after validating field names.

- [x] `snapshotFormat` maps to the wrong key.
  - Current code maps Jest `snapshotFormat` to `snapshotOptions`.
  - Correct Vitest config key is `snapshotFormat`.
  - Desired behavior: emit `snapshotFormat: ...` and warn only for unsupported formatter options such as custom `compareKeys` functions or `plugins`.

- [x] `globalTeardown` is copied as a non-existent Vitest config key.
  - Current code copies `globalTeardown` directly.
  - Vitest uses `globalSetup`; teardown must be exported from the global setup file or returned from the default setup function.
  - Desired behavior: manual warning and/or `// MANUAL:` output comment. Do not emit `globalTeardown`.

- [x] `coverageThreshold.global` needs restructuring.
  - Current code copies Jest `coverageThreshold` directly into `coverage.thresholds`.
  - Jest commonly nests global thresholds under `global`.
  - Vitest expects global thresholds as direct `coverage.thresholds.lines`, `branches`, `functions`, and `statements` keys.
  - Desired behavior:
    - If `coverageThreshold.global` exists, unwrap it into direct `coverage.thresholds`.
    - Preserve file/glob thresholds if compatible, but warn that Vitest counts glob threshold files into global thresholds differently than Jest.
    - Keep the existing warning about V8 AST remapping and re-baselining.

- [x] `expect.getState().currentTestName` warning is reversed.
  - Current warning says Jest uses ` > ` and Vitest uses a space.
  - Official Vitest migration docs say Vitest joins with `>` and Jest joins with a space.
  - Desired behavior: correct the warning text.

## Additional Confirmed Converter Gaps

- [x] `bail: true` needs normalization.
  - Jest accepts boolean `true` as equivalent to `1`.
  - Vitest `bail` is numeric.
  - Desired behavior: map `bail: true` to `bail: 1`; preserve numeric values.

- [x] `coverageProvider: 'babel'` should not be copied.
  - Jest supports `babel` and `v8`.
  - Vitest supports `v8`, `istanbul`, and `custom`.
  - Desired behavior: map `'babel'` to `'istanbul'` with install guidance for `@vitest/coverage-istanbul`; keep `'v8'`; warn for unknown values.

- [x] Coverage install next step should match selected provider.
  - Current code always suggests `@vitest/coverage-v8` when coverage is detected.
  - Desired behavior:
    - `provider: 'v8'` or no provider: suggest `@vitest/coverage-v8`.
    - `provider: 'istanbul'` or Jest `coverageProvider: 'babel'`: suggest `@vitest/coverage-istanbul`.
    - `provider: 'custom'`: do not guess; warn manually.

- [x] `injectGlobals` is missing.
  - Jest defaults to injected globals; Vitest defaults to explicit imports.
  - Desired behavior:
    - `injectGlobals: true`: map to `globals: true` with TypeScript `vitest/globals` next step.
    - `injectGlobals: false`: likely omit, with info warning that explicit imports are already Vitest's default.

- [x] `slowTestThreshold` units differ.
  - Jest value is in seconds.
  - Vitest value is in milliseconds.
  - Desired behavior: numeric value should be multiplied by `1000` before emitting.

- [x] `testSequencer` output is too optimistic.
  - Current code emits `sequence: { sequencer: <source> }`.
  - Vitest expects a sequencer constructor/class compatible with `vitest/node`.
  - Desired behavior: preserve as `// MANUAL:` unless the converter can import and adapt a Vitest-compatible constructor safely.

- [x] `testPathIgnorePatterns` and `coveragePathIgnorePatterns` are regex strings, not globs.
  - Current code copies them into Vitest glob fields.
  - Desired behavior: convert simple `<rootDir>/dir/` cases to globs where safe; otherwise emit verify/manual comments.

- [x] `collectCoverageFrom` negated globs need splitting.
  - Jest accepts negated entries such as `!**/*.d.ts` inside `collectCoverageFrom`.
  - Vitest has separate `coverage.include` and `coverage.exclude`.
  - Desired behavior: split positive entries into `include`, strip `!` and put negative entries into `exclude`.

- [x] `testEnvironment: 'jest-environment-jsdom'` should normalize to `jsdom`.
  - Desired behavior: map known Jest environment package names to Vitest environment names:
    - `jest-environment-jsdom` -> `jsdom`
    - `jest-environment-node` -> `node`
  - Keep custom package/file warnings for everything else.

- [x] Plain `jest.config.json` is not supported.
  - Current JSON extraction only handles `package.json` with a `jest` key.
  - Jest supports standalone `jest.config.json`.
  - Desired behavior: if the input is a JSON object without a `jest` key, treat it as the Jest config object rather than failing.

- [x] `moduleNameMapper` values can be arrays.
  - Jest supports `moduleNameMapper: Record<string, string | string[]>`.
  - Current alias handling assumes a single expression.
  - Desired behavior: handle array fallbacks with a manual warning or choose the first value with verify warning.

- [x] `modulePathIgnorePatterns` is not mapped.
  - Jest includes `modulePathIgnorePatterns`.
  - Desired behavior: warn as no direct Vitest equivalent, or map only if a safe Vite resolver exclusion exists.

- [x] `resetModules` is not mapped or warned explicitly.
  - Jest supports `resetModules`.
  - Desired behavior: warn that this is a per-test isolation/module-cache behavior and may need `vi.resetModules()` or isolation review.

- [x] `snapshotResolver` is missing.
  - Vitest has `resolveSnapshotPath`.
  - Desired behavior: warn/manual-map custom resolver modules to `resolveSnapshotPath` only if the function shape can be adapted.

- [x] `testResultsProcessor` is missing.
  - Desired behavior: manual warning; use a Vitest reporter instead.

- [x] `waitForUnhandledRejections` is missing.
  - Desired behavior: warn that Vitest has different unhandled rejection behavior; verify test results.

- [x] `randomize` / `showSeed` are missing.
  - Vitest has `sequence.shuffle` and `sequence.seed` concepts.
  - Desired behavior: map simple `randomize: true` to `sequence.shuffle`, preserve/show seed guidance where possible.

## Security And Hardening Checklist

- [x] Add XSS regression tests for the editor highlighter.
  - Current highlighter uses `dangerouslySetInnerHTML`, but escapes `&`, `<`, and `>` before token wrapping.
  - Add tests for pasted payloads such as `<script>`, `<img onerror=...>`, SVG event handlers, template literals, and comments.

- [x] Consider replacing the regex highlighter with React-rendered tokens or a vetted highlighter.
  - Current implementation appears safe, but `dangerouslySetInnerHTML` is still a high-risk maintenance surface.

- [x] Add input size limits and worker failure handling.
  - Very large pasted configs can consume browser memory or keep worker requests pending.
  - Desired behavior: input byte/line cap, worker timeout, and pending promise cleanup on worker error.

- [x] Add a CSP before adding ads or third-party scripts.
  - Current `CarbonAd` component returns `null`, but the product plan includes ads/sponsor scripts.
  - CSP should account for the inline theme script, or the theme script should be nonce/hash based.

- [x] Run dependency audit before launch.
  - Use `npm audit` and review Babel/Next/Vitest advisories.

## Local Documentation And Product Claims

- [x] Fix stale checklist claim about Google fonts.
  - `instructions/CONVERTER_SUPPORT_CHECKLIST.md` says Google fonts were removed.
  - Current `src/app/layout.tsx` still imports `next/font/google`.
  - Either remove/localize fonts or update the documentation and accept the network build requirement.

- [x] Update `instructions/JEST-TO-VITEST-GUIDE.md` where stale mappings are now confirmed.
  - `resetMocks` should say `mockReset`.
  - `snapshotFormat` should stay `snapshotFormat`.
  - `globalTeardown` should not be listed as direct.
  - `automock` should not be listed as directly supported.
  - `fakeTimers.enableGlobally` should not map to `install: true`.

- [x] Update `instructions/CONVERTER_SUPPORT_CHECKLIST.md` after each fix.
  - Several items currently marked supported are only partially supported or incorrect.

## Suggested Implementation Order

1. Fix invalid Vitest output keys first:
   - `resetMocks` -> `mockReset`
   - `snapshotFormat`
   - remove `globalTeardown`
   - remove `fakeTimers.install`
   - remove `automock` config output

2. Fix behavior-changing conversions:
   - `coverageThreshold.global`
   - `coverageProvider`
   - provider-specific install steps
   - `currentTestName` warning
   - `bail: true`
   - `slowTestThreshold`

3. Expand missing Jest fields:
   - `injectGlobals`
   - `resetModules`
   - `snapshotResolver`
   - `testResultsProcessor`
   - `waitForUnhandledRejections`
   - `randomize` / `showSeed`

4. Improve pattern/path conversion:
   - `collectCoverageFrom` negation split
   - `testPathIgnorePatterns`
   - `coveragePathIgnorePatterns`
   - path-aware `<rootDir>` normalization

5. Add security and robustness tests:
   - highlighter XSS payloads
   - worker timeout/error cleanup
   - large input behavior

6. Bring local docs back in sync:
   - product guide
   - support checklist
   - build/font claim
