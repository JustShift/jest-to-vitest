# Open work items

Tracked items that are scoped, understood, and not yet implemented. Each one represents a known gap between what a user might reasonably expect and what the converter does today.

When implementing one of these, drop the entry from this file and update `docs/SUPPORT-CHECKLIST.md` to reflect the new state.

## Open

- [ ] **`testRegex` regex-to-glob conversion.**
  - Today: any `testRegex` value falls back to the default Vitest glob (`**/*.{test,spec}.{ts,tsx,js,jsx}`) with a verify warning attached to `include`.
  - Expected: translate common Jest patterns like `(/__tests__/.*|(\\.|/)(test|spec))\\.[jt]sx?$` into a glob equivalent. Cover at least: simple suffix matchers, `__tests__/` directory matchers, and `.jsx` extension alternates.

- [ ] **Real-world fixture suite.**
  - Today: 80 micro-fixture tests in `tests/converter.test.ts`, but no end-to-end snapshot regression against the configs that real projects ship.
  - Expected: a `tests/fixtures/` directory containing `jest.config.js` snapshots from Next.js, Nx, Create React App, Remix, T3 starter, Vue + craco, and Vite + jest hybrids, each paired with an expected-output snapshot. Run as Vitest snapshot tests.
  - Why this matters: the only way to catch regressions on the configs users actually have is to test against them.

- [ ] **Path-aware normalizer for `<rootDir>`.**
  - Today: simple string replace of `<rootDir>/?` with `./`. Works for the benchmark, but does not distinguish globs from package names from filesystem paths.
  - Expected: a normalizer that classifies each occurrence (glob / package name / file path) and applies the appropriate substitution. Should also handle `<rootDir>` in the middle of a string (rare but possible).

- [ ] **`watchPathIgnorePatterns` better-than-manual mapping.**
  - Today: emits a manual warning pointing at Vite's `server.watch.ignored`.
  - Expected: emit the actual `server.watch.ignored` config block in the output when the patterns are static strings, and only fall back to a warning for regex/dynamic inputs.

- [ ] **Web playground.**
  - Today: README links to `https://shiftkit.dev` *(coming soon)*. Every comparison is CLI-vs-CLI — the competitors' home turf.
  - Expected: a hosted browser playground with paste-in input, live preview, and the same warning model as the CLI. Lives in a sibling repo; the npm package's converter API is the engine.

- [ ] **`@shiftkit/jest-to-vitest-codemod` sibling package (optional).**
  - Today: this package converts configs only. Test files (`jest.fn` → `vi.fn`, `@jest/globals` import removal, `jest.Mock<T>` → `Mock<T>`, factory hoisting) are not touched.
  - Expected: a separate npm package focused on test-file transforms, sharing nothing with this package. Keep them separable so users can run one without the other.
  - Open question: do we want to compete with `kamaalio` and `vitest-codemod` on this surface, or stay focused on config? See `docs/GAP-ANALYSIS.md` §1.2.

- [ ] **Drop `@swc/jest` transforms like `ts-jest`/`babel-jest`.**
  - Today: `@swc/jest` entries get a manual warning ("no direct equivalent"). It is the same situation as `ts-jest`: Vite handles the transform natively, so it should be dropped with an info warning.
  - Also: `@vue/vue3-jest` / `vue-jest` and `svelte-jester` should emit concrete plugin suggestions (`@vitejs/plugin-vue`, `@sveltejs/vite-plugin-svelte`) instead of a generic manual warning.

- [ ] **Map deprecated Jest field aliases.**
  - Today: `setupTestFrameworkScriptFile` (old name for `setupFilesAfterEnv`) and `testPathDirs` (old name for `roots`) fall to UNMAPPED. Old codebases stuck on ancient Jest configs are exactly the audience for a migration tool.
  - Expected: treat them as aliases of the modern fields, plus an info warning that the field name was deprecated in Jest.

- [ ] **Map common third-party reporters instead of copying verbatim.**
  - Today: `['jest-junit', { outputDirectory }]` is copied as-is with a verify warning; the emitted config crashes unless `jest-junit` stays installed.
  - Expected: map `jest-junit` to Vitest's built-in `['junit', { outputFile }]` and `github-actions` to Vitest's `'github-actions'`. Keep the verify warning for reporters with no built-in equivalent.

- [ ] **Map `workerThreads: true` (Jest 30) to `pool: 'threads'`.**
  - Today: UNMAPPED manual warning.

- [ ] **Normalize `@happy-dom/jest-environment` to `'happy-dom'`.**
  - Today: falls into the custom-environment verify branch; `jest-environment-jsdom`/`jest-environment-node` are already normalized, this one is not.

- [ ] **Emit Vite regex aliases for non-trivial `moduleNameMapper` keys.**
  - Today: keys with mid-string capture groups reduce to broken string aliases. Vite's `resolve.alias` accepts the array form `{ find: /regex/, replacement: '...$1' }`, so these are representable.
  - Expected: emit the regex form when the key does not reduce cleanly to a string prefix, with a verify warning.

- [ ] **Add a verify warning to the `workerIdleMemoryLimit` → `vmMemoryLimit` mapping.**
  - Today: silent direct rename. `vmMemoryLimit` only applies to the `vmThreads` pool, which is not the default, so the mapped setting may be inert.

- [ ] **Stable warning codes.**
  - Today: warnings are free-text strings. `@shiftkit/webpack-to-vite` ships stable codes, which let CI gate on specific warnings and let the ShiftKit page link each warning to docs.
  - Expected: add a `code` field to `Warning` (non-breaking), align the shape with the webpack-to-vite warning model.

- [ ] **Static evaluator for multi-statement function-form configs.**
  - Today: any function body beyond a single return is refused. `@shiftkit/webpack-to-vite` already has `static-eval.ts` for exactly this (`const config = {...}; config.x = y; module.exports = config`, simple `process.env` ternaries).
  - Expected: port or share that approach. At three tools this may justify a shared internal package; it is also the machinery the ESLint tool needs to drop `new Function()`.

- [ ] **Package-manager-aware next steps and `--apply`.**
  - Today: next-steps comments and `--apply` output always say `npm install`.
  - Expected: detect `pnpm-lock.yaml` / `yarn.lock` / `bun.lockb` (CLI only; the web/API path stays npm) and emit matching commands. Optional `--pm` override.

- [ ] **`--apply` rewrites the setup-file `jest-dom` import.**
  - Today: `--apply` edits `vitest.config.ts` and `package.json` but never touches setup files. The single most-hit migration blocker in current guides is swapping `@testing-library/jest-dom` to `@testing-library/jest-dom/vitest`.
  - Expected: rewrite that one import in detected setup files, behind the existing dirty-tree guard.

- [ ] **`--target-vitest` flag.**
  - Today: output is Vitest-4-first only (inline `projects`, no `poolOptions`). Mirrors nothing.
  - Expected: a `--target-vitest 3|4` flag mirroring webpack-to-vite's `--target-vite`, for teams pinned to Vitest 3 (workspace file, `poolOptions`).

- [ ] **No-`eval` source gate test.**
  - Today: the conversion path is eval-free in practice, but nothing enforces it. `@shiftkit/webpack-to-vite` has a source-level no-`eval`/no-`new Function` test because the ShiftKit production CSP omits `'unsafe-eval'`.
  - Expected: the same gate test here.
