#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  convertJestToVitest,
  PM_COMMANDS,
  type ConversionResult,
  type ConversionFlags,
  type PackageManager,
  type TargetVitest,
} from './converter.js';

const args = process.argv.slice(2);

const showHelp = () => {
  process.stdout.write(`@shiftkit/jest-to-vitest

Convert a Jest config to a Vitest config.

Usage:
  jest-to-vitest [options] [file]
  cat jest.config.js | jest-to-vitest
  jest-to-vitest --apply

Options:
  -m, --mode <mode>     Output mode: 'standalone' (default) or 'merge'
  -s, --strict          Exit non-zero if any 'manual' warnings are emitted
  -q, --quiet           Suppress warnings on stderr
      --json            Emit { output, warnings, flags } as JSON to stdout
      --apply           Write vitest.config.ts to disk, update package.json
      --delete-old      With --apply, also remove the original jest.config.* file
      --force           With --apply, bypass dirty-tree and not-a-git-repo checks
      --pm <pm>         Package manager for next-steps commands: npm|pnpm|yarn|bun
                        (default: detected from the lockfile in the current directory)
      --target-vitest <n>  Target Vitest major: 4 (default) or 3
                        (3: test.workspace key, poolOptions passthrough, @^3 installs)
      --no-format       Disable output pretty-printing
  -h, --help            Show this help

Default (no --apply): reads the input file (or stdin) and writes the converted
config to stdout; warnings go to stderr.

With --apply: detects jest.config.{ts,mts,cts,js,mjs,cjs,json} (or
package.json#jest) in the current directory, writes vitest.config.ts next to
it, updates devDependencies and scripts in package.json, and rewrites the
'@testing-library/jest-dom' import to '/vitest' in detected setup files.
Refuses to run if the working tree is dirty unless --force is passed.
`);
};

interface ParsedArgs {
  mode: 'standalone' | 'merge';
  strict: boolean;
  quiet: boolean;
  json: boolean;
  apply: boolean;
  deleteOld: boolean;
  force: boolean;
  format: boolean;
  pm: PackageManager | null;
  targetVitest: TargetVitest;
  file: string | null;
}

const parseArgs = (): ParsedArgs => {
  let mode: 'standalone' | 'merge' = 'standalone';
  let strict = false;
  let quiet = false;
  let json = false;
  let apply = false;
  let deleteOld = false;
  let force = false;
  let format = true;
  let pm: PackageManager | null = null;
  let targetVitest: TargetVitest = 4;
  let file: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') {
      showHelp();
      process.exit(0);
    } else if (a === '-s' || a === '--strict') {
      strict = true;
    } else if (a === '-q' || a === '--quiet') {
      quiet = true;
    } else if (a === '--json') {
      json = true;
    } else if (a === '--apply' || a === '--write') {
      apply = true;
    } else if (a === '--delete-old') {
      deleteOld = true;
    } else if (a === '--force') {
      force = true;
    } else if (a === '--no-format') {
      format = false;
    } else if (a === '--pm') {
      const next = args[++i];
      if (next !== 'npm' && next !== 'pnpm' && next !== 'yarn' && next !== 'bun') {
        process.stderr.write(`Invalid --pm '${next}'. Use npm, pnpm, yarn, or bun.\n`);
        process.exit(2);
      }
      pm = next;
    } else if (a === '--target-vitest') {
      const next = args[++i];
      if (next !== '3' && next !== '4') {
        process.stderr.write(`Invalid --target-vitest '${next}'. Use 3 or 4.\n`);
        process.exit(2);
      }
      targetVitest = next === '3' ? 3 : 4;
    } else if (a === '-m' || a === '--mode') {
      const next = args[++i];
      if (next !== 'standalone' && next !== 'merge') {
        process.stderr.write(`Invalid --mode '${next}'. Use 'standalone' or 'merge'.\n`);
        process.exit(2);
      }
      mode = next;
    } else if (!a.startsWith('-') && file === null) {
      file = a;
    } else {
      process.stderr.write(`Unknown argument: ${a}\nRun with --help for usage.\n`);
      process.exit(2);
    }
  }

  return { mode, strict, quiet, json, apply, deleteOld, force, format, pm, targetVitest, file };
};

// Lockfile-based package-manager detection (CLI only; the web/API path stays npm).
const detectPackageManager = (cwd: string): PackageManager => {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) return 'bun';
  return 'npm';
};

const readStdin = (): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });

const JEST_CONFIG_FILES = [
  'jest.config.ts',
  'jest.config.mts',
  'jest.config.cts',
  'jest.config.js',
  'jest.config.mjs',
  'jest.config.cjs',
  'jest.config.json',
] as const;

interface FoundConfig {
  path: string;
  isPackageJson: boolean;
}

const findJestConfig = (cwd: string): FoundConfig | null => {
  for (const f of JEST_CONFIG_FILES) {
    const p = join(cwd, f);
    if (existsSync(p)) return { path: p, isPackageJson: false };
  }
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (pkg && typeof pkg === 'object' && 'jest' in pkg) {
        return { path: pkgPath, isPackageJson: true };
      }
    } catch {
      // Ignore unparseable package.json.
    }
  }
  return null;
};

const checkGit = (): { isRepo: boolean; isDirty: boolean } => {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  } catch {
    return { isRepo: false, isDirty: false };
  }
  try {
    const out = execSync('git status --porcelain', { encoding: 'utf8' });
    return { isRepo: true, isDirty: out.trim().length > 0 };
  } catch {
    return { isRepo: true, isDirty: false };
  }
};

const JEST_DEPS_TO_REMOVE = [
  'jest',
  '@types/jest',
  'ts-jest',
  'babel-jest',
  '@swc/jest',
  'jest-environment-jsdom',
  'jest-environment-node',
  'jest-junit',
];

const updatePackageJson = (pkgPath: string, flags: ConversionFlags): { removed: string[]; added: string[] } => {
  const raw = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw);
  const removed: string[] = [];
  const added: string[] = [];

  for (const dep of JEST_DEPS_TO_REMOVE) {
    if (pkg.dependencies && dep in pkg.dependencies) {
      delete pkg.dependencies[dep];
      removed.push(dep);
    }
    if (pkg.devDependencies && dep in pkg.devDependencies) {
      delete pkg.devDependencies[dep];
      removed.push(dep);
    }
  }
  if (pkg.jest) {
    delete pkg.jest;
    removed.push('package.json#jest');
  }

  pkg.devDependencies = pkg.devDependencies ?? {};
  const addDep = (name: string, range: string) => {
    if (!pkg.devDependencies[name]) {
      pkg.devDependencies[name] = range;
      added.push(name);
    }
  };
  // Default version ranges for newly-added devDependencies. Reviewed 2026-05;
  // bump these when the Vitest ecosystem ships new majors (see RELEASING.md).
  const vitestRange = flags.targetVitest === 3 ? '^3.0.0' : '^4.0.0';
  addDep('vitest', vitestRange);
  if (flags.needsCoverage) addDep('@vitest/coverage-v8', vitestRange);
  if (flags.needsJsdom) addDep('jsdom', '^29.0.0');
  if (flags.needsHappyDom) addDep('happy-dom', '^20.0.0');
  if (flags.needsTsconfigPaths) addDep('vite-tsconfig-paths', '^6.0.0');
  if (flags.needsSvgr) addDep('vite-plugin-svgr', '^5.0.0');

  if (pkg.scripts) {
    for (const [k, v] of Object.entries(pkg.scripts)) {
      if (typeof v !== 'string') continue;
      // Replace `jest` invocations at the start of the script or after a shell separator.
      pkg.scripts[k] = v.replace(/(^|[\s|&;])jest(?=\s|$|--)/g, '$1vitest');
    }
  }

  const trailingNewline = raw.endsWith('\n') ? '\n' : '';
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + trailingNewline);
  return { removed, added };
};

// Rewrite the single most-hit migration blocker in detected setup files:
// '@testing-library/jest-dom' (and its '/extend-expect' entry) must become
// '@testing-library/jest-dom/vitest' under Vitest. Runs behind the same
// dirty-tree guard as the rest of --apply.
const rewriteSetupFileImports = (cwd: string, setupFiles: string[]): string[] => {
  const rewritten: string[] = [];
  for (const rel of setupFiles) {
    if (!rel.startsWith('.')) continue; // only file paths, not package specifiers
    const abs = join(cwd, rel);
    if (!existsSync(abs)) continue;
    let src: string;
    try {
      src = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const next = src
      .replace(/(['"])@testing-library\/jest-dom\/extend-expect\1/g, '$1@testing-library/jest-dom/vitest$1')
      .replace(/(['"])@testing-library\/jest-dom\1/g, '$1@testing-library/jest-dom/vitest$1');
    if (next !== src) {
      writeFileSync(abs, next);
      rewritten.push(rel);
    }
  }
  return rewritten;
};

const writeVitestConfig = (cwd: string, output: string, force: boolean): string => {
  const target = join(cwd, 'vitest.config.ts');
  if (existsSync(target) && !force) {
    process.stderr.write(`Refusing to overwrite existing vitest.config.ts. Re-run with --force to overwrite.\n`);
    process.exit(1);
  }
  writeFileSync(target, output.endsWith('\n') ? output : `${output}\n`);
  return target;
};

const runApply = async (parsed: ParsedArgs): Promise<void> => {
  const cwd = process.cwd();
  const found = findJestConfig(cwd);
  if (!found) {
    process.stderr.write(
      `--apply: no jest.config.{ts,mts,cts,js,mjs,cjs,json} or package.json#jest found in ${cwd}.\n`
    );
    process.exit(1);
  }

  const git = checkGit();
  if (git.isDirty && !parsed.force) {
    process.stderr.write(
      `--apply: working tree is dirty (uncommitted changes). Commit or stash first, or re-run with --force.\n`
    );
    process.exit(1);
  }
  if (!git.isRepo && !parsed.force) {
    process.stderr.write(
      `--apply: ${cwd} is not a git repository. Re-run with --force to apply without a way to roll back.\n`
    );
    process.exit(1);
  }

  const pm = parsed.pm ?? detectPackageManager(cwd);
  const input = readFileSync(found.path, 'utf8');
  const result = convertJestToVitest(input, {
    mode: parsed.mode,
    format: parsed.format,
    packageManager: pm,
    targetVitest: parsed.targetVitest,
  });

  if (parsed.strict && result.warnings.some((w) => w.type === 'manual')) {
    process.stderr.write(`--apply --strict: ${result.warnings.filter((w) => w.type === 'manual').length} manual warning(s); aborting before write.\n`);
    for (const w of result.warnings.filter((w) => w.type === 'manual')) {
      process.stderr.write(`  [manual] (${w.code}) ${w.message}\n`);
    }
    process.exit(1);
  }

  const written = writeVitestConfig(cwd, result.output, parsed.force);
  const pkgPath = join(cwd, 'package.json');
  let pkgUpdate: { removed: string[]; added: string[] } | null = null;
  if (existsSync(pkgPath)) {
    pkgUpdate = updatePackageJson(pkgPath, result.flags);
  }

  const setupRewritten = rewriteSetupFileImports(cwd, result.flags.setupFiles);

  let removed: string | null = null;
  if (parsed.deleteOld && !found.isPackageJson) {
    unlinkSync(found.path);
    removed = found.path;
  }

  if (parsed.json) {
    process.stdout.write(
      JSON.stringify(
        {
          wrote: written,
          source: found.path,
          packageJsonUpdated: pkgUpdate ? pkgPath : null,
          packageJsonRemoved: pkgUpdate?.removed ?? [],
          packageJsonAdded: pkgUpdate?.added ?? [],
          setupFilesRewritten: setupRewritten,
          deletedSource: removed,
          warnings: result.warnings,
          flags: result.flags,
        },
        null,
        2
      ) + '\n'
    );
    return;
  }

  process.stdout.write(`✓ Wrote ${written}\n`);
  if (pkgUpdate) {
    if (pkgUpdate.removed.length > 0) process.stdout.write(`✓ Removed from package.json: ${pkgUpdate.removed.join(', ')}\n`);
    if (pkgUpdate.added.length > 0) process.stdout.write(`✓ Added to package.json devDependencies: ${pkgUpdate.added.join(', ')}\n`);
  }
  if (setupRewritten.length > 0) {
    process.stdout.write(`✓ Rewrote @testing-library/jest-dom import to /vitest in: ${setupRewritten.join(', ')}\n`);
  }
  if (removed) process.stdout.write(`✓ Deleted ${removed}\n`);
  process.stdout.write(`\nNext: run \`${PM_COMMANDS[pm].install}\` to install the new devDependencies, then run your tests.\n`);

  const manualCount = result.warnings.filter((w) => w.type === 'manual').length;
  const verifyCount = result.warnings.filter((w) => w.type === 'verify').length;
  if (!parsed.quiet && (manualCount > 0 || verifyCount > 0)) {
    process.stdout.write(`\n${manualCount} manual warning(s), ${verifyCount} verify warning(s) — see inline comments in ${written}.\n`);
    if (manualCount > 0) {
      process.stdout.write(`\nManual warnings (need attention):\n`);
      for (const w of result.warnings.filter((w) => w.type === 'manual')) {
        process.stdout.write(`  • ${w.message}\n`);
      }
    }
  }
};

const runStdout = async (parsed: ParsedArgs): Promise<void> => {
  const input = parsed.file ? readFileSync(parsed.file, 'utf8') : await readStdin();
  if (!input.trim()) {
    process.stderr.write('No input provided. Pass a file path or pipe via stdin (or use --apply to auto-detect).\n');
    process.exit(2);
  }

  const result: ConversionResult = convertJestToVitest(input, {
    mode: parsed.mode,
    format: parsed.format,
    packageManager: parsed.pm ?? detectPackageManager(process.cwd()),
    targetVitest: parsed.targetVitest,
  });

  if (parsed.json) {
    process.stdout.write(
      JSON.stringify(
        { output: result.output, warnings: result.warnings, flags: result.flags },
        null,
        2
      ) + '\n'
    );
  } else {
    process.stdout.write(result.output + '\n');
    if (!parsed.quiet && result.warnings.length > 0) {
      process.stderr.write(`\n${result.warnings.length} warning(s):\n`);
      for (const w of result.warnings) {
        process.stderr.write(`  [${w.type}] (${w.code}) ${w.message}\n`);
      }
    }
  }

  if (parsed.strict && result.warnings.some((w) => w.type === 'manual')) {
    process.exit(1);
  }
};

const main = async () => {
  const parsed = parseArgs();
  if (parsed.apply) {
    await runApply(parsed);
  } else {
    await runStdout(parsed);
  }
};

main().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
