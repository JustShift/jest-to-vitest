# Open work items

Tracked items that are scoped, understood, and not yet implemented. Each one represents a known gap between what a user might reasonably expect and what the converter does today.

When implementing one of these, drop the entry from this file and update `docs/SUPPORT-CHECKLIST.md` to reflect the new state.

The 2026-06-13 pass implemented everything that lives inside this package: testRegex regex-to-glob conversion, the real-world fixture suite (`tests/fixtures/` + `tests/fixtures.test.ts`), the path-aware `<rootDir>` normalizer, `watchPathIgnorePatterns` → `server.watch.ignored` emission, `@swc/jest`/vue/svelte transform classification, deprecated field aliases (`setupTestFrameworkScriptFile`, `testPathDirs`), `jest-junit`/`github-actions` reporter mapping, `workerThreads` → `pool: 'threads'`, `@happy-dom/jest-environment` normalization, regex-form `resolve.alias` emission, the `vmMemoryLimit` verify warning, stable warning codes (`Warning.code`, aligned with webpack-to-vite), the multi-statement static evaluator, package-manager-aware next steps (`--pm` + lockfile detection), the `--apply` jest-dom setup-file rewrite, the `--target-vitest 3|4` flag, and the no-`eval` source gate test.

## Open

- [ ] **Web playground.**
  - Today: README links to `https://shiftkit.dev` *(coming soon)*. Every comparison is CLI-vs-CLI — the competitors' home turf.
  - Expected: a hosted browser playground with paste-in input, live preview, and the same warning model as the CLI. Lives in a sibling repo; the npm package's converter API is the engine.
  - Status: not implementable inside this repo — tracked here until the sibling repo exists.

- [ ] **`@shiftkit/jest-to-vitest-codemod` sibling package (optional).**
  - Today: this package converts configs only. Test files (`jest.fn` → `vi.fn`, `@jest/globals` import removal, `jest.Mock<T>` → `Mock<T>`, factory hoisting) are not touched.
  - Expected: a separate npm package focused on test-file transforms, sharing nothing with this package. Keep them separable so users can run one without the other.
  - Open question: do we want to compete with `kamaalio` and `vitest-codemod` on this surface, or stay focused on config? See `docs/GAP-ANALYSIS.md` §1.2.
  - Status: not implementable inside this repo — it is by definition a separate package.
