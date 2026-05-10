#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { convertJestToVitest } from './converter.js';

const args = process.argv.slice(2);

const showHelp = () => {
  process.stdout.write(`@shiftkit/jest-to-vitest

Convert a Jest config to a Vitest config.

Usage:
  jest-to-vitest [options] [file]
  cat jest.config.js | jest-to-vitest

Options:
  -m, --mode <mode>   Output mode: 'standalone' (default) or 'merge'
  -s, --strict        Exit non-zero if any 'manual' warnings are emitted
  -q, --quiet         Suppress warnings on stderr
  -h, --help          Show this help

If no file is given, input is read from stdin.
The converted config is written to stdout.
Warnings are written to stderr.
`);
};

const parseArgs = () => {
  let mode: 'standalone' | 'merge' = 'standalone';
  let strict = false;
  let quiet = false;
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

  return { mode, strict, quiet, file };
};

const readStdin = (): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });

const main = async () => {
  const { mode, strict, quiet, file } = parseArgs();
  const input = file ? readFileSync(file, 'utf8') : await readStdin();

  if (!input.trim()) {
    process.stderr.write('No input provided. Pass a file path or pipe via stdin.\n');
    process.exit(2);
  }

  const result = convertJestToVitest(input, { mode });
  process.stdout.write(result.output + '\n');

  if (!quiet && result.warnings.length > 0) {
    process.stderr.write(`\n${result.warnings.length} warning(s):\n`);
    for (const w of result.warnings) {
      process.stderr.write(`  [${w.type}] ${w.message}\n`);
    }
  }

  if (strict && result.warnings.some((w) => w.type === 'manual')) {
    process.exit(1);
  }
};

main().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
