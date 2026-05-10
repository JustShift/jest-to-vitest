# @shiftkit/jest-to-vitest

Convert a Jest config to a Vitest config. AST-based, framework-aware, with actionable warnings.

Part of [ShiftKit](https://github.com/JustShift) — config converters for JavaScript developers.

## Install

```bash
npm install -D @shiftkit/jest-to-vitest
# or run without installing
npx @shiftkit/jest-to-vitest jest.config.js
```

## CLI

```bash
# from a file
jest-to-vitest jest.config.js > vitest.config.ts

# from stdin
cat jest.config.js | jest-to-vitest > vitest.config.ts

# strict mode: exit non-zero if any field needs manual review
jest-to-vitest --strict jest.config.js
```

Options:

| Flag | Description |
|---|---|
| `-m, --mode <mode>` | `standalone` (default) or `merge` (for an existing `vite.config.ts`) |
| `-s, --strict` | Exit non-zero if any `manual` warnings are emitted |
| `-q, --quiet` | Suppress warnings on stderr |
| `-h, --help` | Show usage |

## Programmatic

```ts
import { convertJestToVitest } from '@shiftkit/jest-to-vitest';

const { output, warnings, flags } = convertJestToVitest(source, { mode: 'standalone' });

console.log(output);          // the generated vitest.config.ts
console.log(warnings);        // [{ type: 'manual' | 'verify' | 'info', message: string }, ...]
console.log(flags.needsJsdom); // detection signals for the calling tool
```

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

## Development

```bash
npm install
npm test
npm run build
```

## Reporting bugs

If you have a `jest.config` that converts incorrectly, please [open an issue](https://github.com/JustShift/jest-to-vitest/issues/new?template=broken-config.yml) with the input and the expected output.

## License

MIT
