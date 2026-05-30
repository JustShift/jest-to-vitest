# Changelog

<!--
  Keep an "## Unreleased" section at the top while work accumulates.
  At release time, rename it to "## <version> — <YYYY-MM-DD>" BEFORE tagging —
  the release workflow extracts that exact section for the GitHub Release notes.
-->

## Unreleased

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
