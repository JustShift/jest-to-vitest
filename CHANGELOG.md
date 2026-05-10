# Changelog

## 0.1.4 — 2026-05-10

- chore: relicense from MIT to Apache-2.0 (stronger patent grant; SPDX-clean field for npm)

## 0.1.0 — Initial release

- AST-based Jest → Vitest config converter
- CLI: `jest-to-vitest` reads from a file or stdin
- Programmatic API: `convertJestToVitest(source, options)`
- Handles `module.exports`, `export default`, function-form configs, embedded `vue.config` / `craco.config` blocks, and `package.json` `"jest"` keys
- Maps coverage, transforms, fakeTimers, poolOptions (Vitest 4), moduleNameMapper, and ~50 other fields
- Emits `manual` / `verify` / `info` warnings for fields that need human review
