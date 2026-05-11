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
