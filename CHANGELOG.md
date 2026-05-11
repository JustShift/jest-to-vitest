# Changelog

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
