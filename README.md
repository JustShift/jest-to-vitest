# @shiftkit/jest-to-vitest

Convert a Jest config to a Vitest config. AST-based, framework-aware, with actionable warnings.

Part of [ShiftKit](https://github.com/JustShift) — config converters for JavaScript developers.

## Install

```bash
npm install -D @shiftkit/jest-to-vitest
# or run without installing
npx @shiftkit/jest-to-vitest jest.config.js
```

### Supply-chain hygiene (recommended)

Add a 7-day quarantine on new npm versions to your `.npmrc`:

```
min-release-age=7
```

This would have blocked every major npm supply-chain attack in 2026 (Axios, Trivy, LiteLLM, Telnyx, Checkmarx) — malicious versions are typically caught and unpublished within hours. Releases of this package are published from GitHub Actions via [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC, no long-lived tokens), and every release ships with a provenance attestation.

## CLI

```bash
# Convert and write to stdout (warnings on stderr)
jest-to-vitest jest.config.js > vitest.config.ts

# Convert from stdin
cat jest.config.js | jest-to-vitest > vitest.config.ts

# Apply directly to the repo: writes vitest.config.ts, updates package.json
jest-to-vitest --apply

# Apply + delete the original jest.config (requires clean git tree)
jest-to-vitest --apply --delete-old

# Machine-readable output for CI
jest-to-vitest --json jest.config.js | jq '.warnings[] | select(.type == "manual")'

# Strict: exit non-zero if any field needs manual review
jest-to-vitest --strict jest.config.js
```

Options:

| Flag | Description |
|---|---|
| `-m, --mode <mode>` | `standalone` (default) or `merge` (for an existing `vite.config.ts`) |
| `--apply` | Auto-detect `jest.config.*` (or `package.json#jest`) and write `vitest.config.ts` to disk, update `package.json` (deps + scripts). Refuses to run on a dirty git tree (override with `--force`). |
| `--delete-old` | With `--apply`, also remove the original `jest.config.*` file |
| `--force` | With `--apply`, bypass dirty-tree and not-a-git-repo checks |
| `--json` | Emit `{ output, warnings, flags }` (or the `--apply` payload) as JSON to stdout |
| `--pm <pm>` | Package manager for next-steps commands: `npm`/`pnpm`/`yarn`/`bun` (default: detected from the lockfile) |
| `--target-vitest <n>` | Target Vitest major: `4` (default) or `3` (`test.workspace` key, `poolOptions` passthrough, `@^3` installs) |
| `--no-format` | Disable output pretty-printing |
| `-s, --strict` | Exit non-zero if any `manual` warnings are emitted |
| `-q, --quiet` | Suppress warnings on stderr |
| `-h, --help` | Show usage |

`--apply` writes `vitest.config.ts`, removes `jest`/`@types/jest`/`ts-jest`/`babel-jest`/`@swc/jest` from `devDependencies`, adds `vitest` and any required peers (`@vitest/coverage-v8`, `jsdom`, `happy-dom`, `vite-tsconfig-paths`, `vite-plugin-svgr`) at sensible major ranges, rewrites `jest` invocations in `scripts`, and rewrites the `'@testing-library/jest-dom'` import to `'@testing-library/jest-dom/vitest'` in detected setup files. Run your package manager's install afterwards.

## Programmatic

```ts
import { convertJestToVitest } from '@shiftkit/jest-to-vitest';

const { output, warnings, flags } = convertJestToVitest(source, {
  mode: 'standalone',    // or 'merge'
  format: true,           // pretty-print output (default true)
  packageManager: 'npm',  // commands used in the next-steps block (default npm)
  targetVitest: 4,        // or 3 for teams pinned to Vitest 3
});

console.log(output);          // the generated vitest.config.ts
console.log(warnings);        // [{ type: 'manual' | 'verify' | 'info', code: WarningCode, message: string }, ...]
console.log(flags.needsJsdom); // detection signals for the calling tool
console.log(flags.setupFiles); // detected setup-file paths (etc.)
```

Every warning carries a stable `code` (e.g. `discovery.testRegex`, `mocks.hoisting`), aligned with the `@shiftkit/webpack-to-vite` warning model, so CI can gate on specific warnings and reports are machine-filterable.

## GitHub Action

```yaml
# .github/workflows/migrate.yml
jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: JustShift/jest-to-vitest@v1
        with:
          apply: 'true'
          delete-old: 'true'
          strict: 'true'
      - run: npm install
      - run: npm test
```

The action inputs mirror the CLI flags (`file`, `mode`, `apply`, `delete-old`, `strict`, `force`, `working-directory`, `package-version`). Outputs: `output-file`, `warning-count`, `manual-count`, `json` (full JSON payload).

## What's supported

Maps the common Jest fields to their Vitest equivalents:

- `testEnvironment`, `testEnvironmentOptions`, `testURL`
- `testMatch`, `testRegex`, `testPathIgnorePatterns`, `roots`
- `setupFiles`, `setupFilesAfterEnv`, `globalSetup`, `globalTeardown`
- `moduleNameMapper`, `moduleFileExtensions`, `moduleDirectories`
- `transform`, `transformIgnorePatterns` (extracts package names → `test.server.deps.inline`)
- `coverage*` fields → `test.coverage.*`
- `globals` → root-level Vite `define`
- `fakeTimers`, `timers`, `maxWorkers`, `runInBand`, `poolOptions`
- `projects` → `test.projects` (Vitest 4 inline workspaces)
- `displayName`, `bail`, `testTimeout`, `verbose`, `reporters`
- Embedded `jest:` block in `vue.config.js` / `craco.config.js`
- Function-form configs (`module.exports = () => ({...})`)
- `pathsToModuleNameMapper` → `vite-tsconfig-paths` plugin
- `package.json` `"jest"` key
- TypeScript / `satisfies Config` / `as Config`

## What's not supported

These emit a warning instead of generating wrong code:

- `watchPlugins`, `testRunner`, `dependencyExtractor`, `haste`, `resolver`
- `automock: true` (Vitest only auto-mocks files in adjacent `__mocks__/`)
- `timers: 'legacy'` and `fakeTimers.legacyFakeTimers`
- Custom `testEnvironment` files (Vitest's environment interface differs)
- `testSequencer` (interface differs from Jest)
- `unmockedModulePathPatterns`, `watchPathIgnorePatterns`
- Dynamic spreads, computed keys, object methods inside the config
- Custom `transform` entries (replace with Vite plugins)

The output also includes behavioral warnings about `vi.mock` hoisting,
`describe`/`test` name separator changes, snapshot regeneration, and Testing
Library cleanup behavior under `globals: true`.

## Web playground

Try it without installing: <https://shiftkit.dev> *(coming soon)*

## Deeper docs

- [`docs/MIGRATION-GUIDE.md`](docs/MIGRATION-GUIDE.md) — comprehensive Jest → Vitest migration blueprint, edge cases, Vitest 4 breaking changes
- [`docs/SUPPORT-CHECKLIST.md`](docs/SUPPORT-CHECKLIST.md) — audit of which Jest fields the converter handles, with status per field
- [`docs/RE-EVALUATION-FINDINGS.md`](docs/RE-EVALUATION-FINDINGS.md) — working notes from the most recent converter pass against current Vitest docs
- [`RELEASING.md`](RELEASING.md) — branching, versioning, hotfix, and release pipeline notes

## Development

```bash
npm install
npm test
npm run build
```

## Reporting bugs

If you have a `jest.config` that converts incorrectly, please [open an issue](https://github.com/JustShift/jest-to-vitest/issues/new?template=broken-config.yml) with the input and the expected output.

## License

Apache-2.0
