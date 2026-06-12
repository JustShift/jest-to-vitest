# Changelog

<!--
  Keep an "## Unreleased" section at the top while work accumulates.
  At release time, rename it to "## <version> — <YYYY-MM-DD>" BEFORE tagging —
  the release workflow extracts that exact section for the GitHub Release notes.
-->

## 0.4.0 — 2026-06-13

- feat(converter): **stable warning codes** — every `Warning` now carries a
  `code` field (e.g. `discovery.testRegex`, `resolve.aliasRegex`,
  `mocks.hoisting`), aligned with the `@shiftkit/webpack-to-vite` warning
  model. Non-breaking: the `message`/`type` fields are unchanged. The CLI now
  prints `[tier] (code) message`.
- feat(converter): **testRegex regex-to-glob conversion** — simple suffix
  matchers (`\.test\.tsx?$`), `__tests__/` directory matchers, extension
  alternates (`[jt]sx?`, `(js|jsx|ts|tsx)`), and the classic Jest/CRA default
  `(/__tests__/.*|(\.|/)(test|spec))\.[jt]sx?$` now translate to equivalent
  `test.include` globs with a verify warning, at the root and inside
  `projects`. Untranslatable patterns keep the default-glob fallback.
- feat(converter): **multi-statement static evaluation** — `const config =
  {...}; config.x = y; module.exports = config` and function bodies building a
  local config object are folded statically (later assignments win; if-guarded
  assignments fold unconditionally with a `config.multiStatement` verify
  callout). No user code is ever executed.
- feat(converter): **path-aware `<rootDir>` normalizer** (`normalizeRootDir`,
  exported) — a bare `<rootDir>` becomes `.`, occurrences after `/` or regex
  anchors collapse, mid-string occurrences keep a single separator. Replaces
  the blanket `<rootDir>/? -> ./` string replace.
- feat(converter): `watchPathIgnorePatterns` with static strings now emits the
  actual root-level `server.watch.ignored` block; regex/dynamic entries keep
  the manual warning.
- feat(converter): non-trivial `moduleNameMapper` keys (mid-string capture
  groups) now emit Vite's array-form regex alias
  `{ find: /regex/, replacement: '...$1' }` instead of a broken string alias.
- feat(converter): `jest-junit` maps to Vitest's built-in
  `['junit', { outputFile }]` (outputDirectory/outputName folded into
  outputFile) and `github-actions` to the built-in `'github-actions'`;
  the verbatim-copy verify warning now fires only for non-built-in reporters.
- feat(converter): `@swc/jest` transforms are dropped like `ts-jest`/
  `babel-jest`; `@vue/vue3-jest`/`vue-jest` and `svelte-jester` emit concrete
  plugin suggestions (`@vitejs/plugin-vue`, `@sveltejs/vite-plugin-svelte`).
- feat(converter): deprecated Jest field aliases — `setupTestFrameworkScriptFile`
  is treated as `setupFilesAfterEnv` and `testPathDirs` as `roots`, each with a
  deprecation info warning.
- feat(converter): `workerThreads: true` (Jest 30) maps to `pool: 'threads'`;
  `@happy-dom/jest-environment` is normalized to `'happy-dom'`; the
  `workerIdleMemoryLimit` → `vmMemoryLimit` mapping now carries an inline
  `// VERIFY:` note (it only applies to the `vmThreads` pool).
- feat(converter): **package-manager-aware next steps** —
  `ConvertOptions.packageManager` ('npm' default keeps the web/API path
  unchanged); the CLI detects `pnpm-lock.yaml`/`yarn.lock`/`bun.lockb` and
  accepts `--pm` to override.
- feat(converter/cli): **`--target-vitest 3|4`** (API:
  `ConvertOptions.targetVitest`) — 3 emits the `test.workspace` key, passes
  `poolOptions` through verbatim, and pins installs to `@^3`/`^3.0.0`.
- feat(cli): `--apply` now rewrites `'@testing-library/jest-dom'` (and
  `/extend-expect`) imports to `'@testing-library/jest-dom/vitest'` in
  detected setup files (`flags.setupFiles`, new), behind the dirty-tree guard.
- test: **real-world fixture suite** — `tests/fixtures/` holds jest configs in
  the shape Next.js, Nx, CRA (package.json#jest), Remix, T3, Vue + craco, and
  Vite + jest hybrids actually ship; `tests/fixtures.test.ts` snapshots the
  full output, warning report, and flags, and asserts determinism.
- test: no-`eval` source gate (`tests/no-eval.test.ts`) — the converter source
  must never contain `eval(`, `new Function`, or `vm.runInContext` (the
  ShiftKit production CSP omits `'unsafe-eval'`).

## 0.3.0 — 2026-06-11

- feat(converter): detect `next/jest` wrapper configs (`createJestConfig(...)`
  produced by the `next/jest` factory). The inner Jest config is converted, and
  `@vitejs/plugin-react` + `vite-tsconfig-paths` are added to cover the SWC
  preset's implicit TS/JSX and path-alias handling, with a warning that CSS and
  `next/image`-style imports may still need setup-file mocks.
- feat(converter): resolve identifier arguments passed to unknown wrapper calls,
  so `wrap(customConfig)` is analyzed instead of dropped.
- feat(converter): remap `projects` entries to the Vitest `{ test: { ... } }`
  shape; glob-string entries pass through with `<rootDir>` normalized;
  unmappable project fields are preserved as MANUAL comments with a warning;
  a non-static `projects` value falls back to MANUAL.
- fix(converter): nest `testEnvironmentOptions` under the resolved environment
  (jsdom / happy-dom) regardless of key order; keep it MANUAL when the
  environment takes no options.
- fix(converter): drop `customExportConditions` with a manual warning.
- fix(converter): strip non-capturing-group syntax from
  `transformIgnorePatterns` packages, handle pnpm-style chained lookaheads
  (excluding `.pnpm`), and warn instead of emitting garbage for unparseable
  lookahead items.

## 0.2.1 — 2026-05-30

- fix(converter): `vite-plugin-svgr` is now emitted **only** when a `moduleNameMapper` entry's _target_ is an SVG-to-component transformer (e.g. `@svgr/*`, `jest-svg-transformer`). Previously any key mentioning `.svg` — including generic stubs mapped to `fileMock.js` or `identity-obj-proxy` — silently pulled in `vite-plugin-svgr` and rewrote SVG imports to `?react`. Such stubs now emit a verify warning instead, with no unexpected dependency or import-semantics change.
- fix(converter): single-extension asset/font keys (e.g. `\.svg$`, `\.png$`, `\.woff2$`) are now recognized as asset/font stubs instead of becoming invalid regex-keyed `resolve.alias` entries.
- chore(cli): bump default `--apply` devDependency ranges to current majors — `jsdom@^29`, `happy-dom@^20`, `vite-tsconfig-paths@^6`, `vite-plugin-svgr@^5` (`vitest@^4` unchanged).
- style(converter): `server.deps.inline` package names now use single quotes, matching the rest of the generated config.
- ci: tests are now type-checked in CI via `tsconfig.test.json` (`npm run lint` covers `tests/` too).
- ci: the release workflow now creates a **GitHub Release** (notes sourced from this changelog) after publishing to npm.
- docs: `RELEASING.md` rewritten as a single, consistent, step-by-step trunk-based guide.

## 0.2.0 — 2026-05-11

- feat(cli): `--apply` mode auto-detects `jest.config.{ts,mts,cts,js,mjs,cjs,json}` (or `package.json#jest`), writes `vitest.config.ts`, updates `package.json` deps and scripts. Refuses to run on a dirty git tree (`--force` to override). Optional `--delete-old` removes the original Jest config.
- feat(cli): `--json` emits `{ output, warnings, flags }` (or the apply payload) as JSON for CI integration
- feat(cli): `--no-format` disables output pretty-printing
- feat(converter): pretty-printer for multi-line arrays and objects (e.g. `projects`, `coverageThreshold`); no new dependencies
- feat(converter): inline `// VERIFY:` and `// MANUAL:` comments alongside field-tied warnings (`mockReset`, `setupFiles`, `reporters`, `deps`, `thresholds`, `environmentOptions`, `globalSetup`) so they survive `> vitest.config.ts` redirection
- feat(converter): SVG stubs in `moduleNameMapper` now emit `vite-plugin-svgr` plugin import, `plugins: [svgr()]`, and install step (was previously just a warning)
- feat(converter): detect CommonJS extensions (`.js`, `.cjs`) in `globalSetup` and emit a verify warning (Vitest expects ESM default export)
- feat(converter): new `format: boolean` option in `ConvertOptions`; new `needsSvgr` flag in `ConversionFlags`
- feat(action): first-party GitHub Action (`JustShift/jest-to-vitest@v1`) wrapping the CLI with `--json` parsing into `output-file` / `warning-count` / `manual-count` / `json` outputs

## 0.1.4 — 2026-05-10

- chore: relicense from MIT to Apache-2.0 (stronger patent grant; SPDX-clean field for npm)

## 0.1.0 — Initial release

- AST-based Jest → Vitest config converter
- CLI: `jest-to-vitest` reads from a file or stdin
- Programmatic API: `convertJestToVitest(source, options)`
- Handles `module.exports`, `export default`, function-form configs, embedded `vue.config` / `craco.config` blocks, and `package.json` `"jest"` keys
- Maps coverage, transforms, fakeTimers, poolOptions (Vitest 4), moduleNameMapper, and ~50 other fields
- Emits `manual` / `verify` / `info` warnings for fields that need human review
