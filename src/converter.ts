import * as parser from '@babel/parser';
import _traverse, { type NodePath, type Scope } from '@babel/traverse';
import _generator from '@babel/generator';
import * as t from '@babel/types';

// Babel ships CJS that interops oddly with NodeNext + strict TS. The runtime
// check picks the callable regardless of how the bundler resolves default.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const traverse: any =
  typeof _traverse === 'function'
    ? _traverse
    : (_traverse as unknown as { default: unknown }).default;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const generate: any =
  typeof _generator === 'function'
    ? _generator
    : (_generator as unknown as { default: unknown }).default;

export type WarningType = 'manual' | 'verify' | 'info';

/**
 * Stable warning codes (aligned with the @shiftkit/webpack-to-vite warning
 * model). Codes let CI gate on specific warnings and let docs link per-warning.
 * Adding codes is non-breaking; renaming or removing one is a breaking change.
 */
export type WarningCode =
  // config / input shape
  | 'config.parseError'
  | 'config.notFound'
  | 'config.functionForm'
  | 'config.multiStatement'
  | 'config.embedded'
  | 'config.nextJest'
  | 'config.dynamic'
  | 'config.conflict'
  | 'config.unmapped'
  // test discovery
  | 'discovery.testRegex'
  | 'discovery.exclude'
  | 'discovery.roots'
  | 'discovery.deprecatedAlias'
  // environment
  | 'env.environment'
  | 'env.options'
  | 'env.url'
  // setup / teardown
  | 'setup.files'
  | 'setup.order'
  | 'setup.done'
  | 'setup.globalSetup'
  | 'setup.globalTeardown'
  // coverage
  | 'coverage.provider'
  | 'coverage.thresholds'
  | 'coverage.include'
  | 'coverage.removed'
  // module resolution
  | 'resolve.alias'
  | 'resolve.aliasRegex'
  | 'resolve.cssStub'
  | 'resolve.assetStub'
  | 'resolve.fontStub'
  | 'resolve.svgr'
  | 'resolve.extensions'
  | 'resolve.moduleDirectories'
  | 'resolve.modulePaths'
  | 'resolve.tsconfigPaths'
  // transforms / presets
  | 'transform.preset'
  | 'transform.dropped'
  | 'transform.fileStub'
  | 'transform.framework'
  | 'transform.custom'
  | 'transform.ignorePatterns'
  // mocking
  | 'mocks.automock'
  | 'mocks.reset'
  | 'mocks.hoisting'
  | 'mocks.modules'
  // timers
  | 'timers.fake'
  | 'timers.legacy'
  // parallelism / performance
  | 'workers.maxWorkers'
  | 'workers.pool'
  | 'workers.memoryLimit'
  | 'workers.detect'
  // reporters
  | 'reporters.mapped'
  | 'reporters.verbatim'
  | 'reporters.dynamic'
  | 'reporters.processor'
  // snapshots
  | 'snapshot.serializers'
  | 'snapshot.format'
  | 'snapshot.resolver'
  | 'snapshot.regen'
  // sequencing
  | 'sequence.shuffle'
  | 'sequence.sequencer'
  | 'sequence.seed'
  // projects / monorepo
  | 'projects.remapped'
  | 'projects.field'
  | 'projects.dynamic'
  | 'projects.inline'
  // globals
  | 'globals.define'
  | 'globals.true'
  // watch
  | 'watch.ignored'
  | 'watch.plugins'
  // behavioral migration notes
  | 'behavior.hooks'
  | 'behavior.currentTestName'
  | 'behavior.jestNamespace'
  // catch-alls for removed / no-equivalent fields
  | 'field.removed'
  | 'field.noEquivalent';

export interface Warning {
  type: WarningType;
  code: WarningCode;
  message: string;
}

export type OutputMode = 'standalone' | 'merge';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type TargetVitest = 3 | 4;

export interface ConvertOptions {
  mode?: OutputMode;
  format?: boolean;
  /** Package manager used in next-steps commands. Defaults to npm (the web/API path). */
  packageManager?: PackageManager;
  /** Target Vitest major. 4 (default): inline projects, no poolOptions. 3: workspace key, poolOptions passthrough. */
  targetVitest?: TargetVitest;
}

export interface ConversionFlags {
  monorepo: boolean;
  embeddedParent: 'vue.config' | 'craco.config' | null;
  needsCoverage: boolean;
  needsJsdom: boolean;
  needsHappyDom: boolean;
  needsTsconfigPaths: boolean;
  needsSvgr: boolean;
  usesGlobalsTrue: boolean;
  /** Detected setup-file paths (string literals from setupFiles/setupFilesAfterEnv, <rootDir> normalized). */
  setupFiles: string[];
  targetVitest: TargetVitest;
}

// Package-manager command templates for the next-steps block and CLI hints.
export const PM_COMMANDS: Record<
  PackageManager,
  { add: (pkgs: string) => string; remove: (pkgs: string) => string; install: string }
> = {
  npm: { add: (p) => `npm install -D ${p}`, remove: (p) => `npm uninstall ${p}`, install: 'npm install' },
  pnpm: { add: (p) => `pnpm add -D ${p}`, remove: (p) => `pnpm remove ${p}`, install: 'pnpm install' },
  yarn: { add: (p) => `yarn add -D ${p}`, remove: (p) => `yarn remove ${p}`, install: 'yarn install' },
  bun: { add: (p) => `bun add -d ${p}`, remove: (p) => `bun remove ${p}`, install: 'bun install' },
};

export interface ConversionResult {
  output: string;
  warnings: Warning[];
  flags: ConversionFlags;
}

interface ConfigSection {
  scalars: Map<string, string>;
  arrays: Map<string, string[]>;
  raw: string[];
  noteFor: Map<string, string>;
}

const newSection = (): ConfigSection => ({
  scalars: new Map(),
  arrays: new Map(),
  raw: [],
  noteFor: new Map(),
});

const ASSET_EXTS = ['gif', 'png', 'jpg', 'jpeg', 'svg', 'webp', 'avif', 'ico'];
const FONT_EXTS = ['woff', 'woff2', 'eot', 'ttf', 'otf'];
const VITEST_FAKE_TIMER_OPTIONS = new Set([
  'now',
  'toFake',
  'loopLimit',
  'shouldAdvanceTime',
  'advanceTimeDelta',
  'shouldClearNativeTimers',
  'ignoreMissingTimers',
]);

export function convertJestToVitest(
  input: string,
  options: ConvertOptions = {}
): ConversionResult {
  const mode: OutputMode = options.mode ?? 'standalone';
  const format: boolean = options.format ?? true;
  const pm = PM_COMMANDS[options.packageManager ?? 'npm'];
  const targetVitest: TargetVitest = options.targetVitest ?? 4;
  const warnings: Warning[] = [];
  const seenWarnings = new Set<string>();

  const pushWarning = (type: WarningType, code: WarningCode, message: string) => {
    const key = `${type}::${message}`;
    if (seenWarnings.has(key)) return;
    seenWarnings.add(key);
    warnings.push({ type, code, message });
  };
  const warnInfo = (code: WarningCode, msg: string) => pushWarning('info', code, msg);
  const warnVerify = (code: WarningCode, msg: string) => pushWarning('verify', code, msg);
  const warnManual = (code: WarningCode, msg: string) => pushWarning('manual', code, msg);

  // 1. package.json with a "jest" key.
  if (input.trim().startsWith('{')) {
    try {
      const json = JSON.parse(input);
      if (json && typeof json === 'object' && 'jest' in json) {
        input = `module.exports = ${JSON.stringify(json.jest, null, 2)}`;
      } else if (json && typeof json === 'object' && !Array.isArray(json)) {
        input = `module.exports = ${JSON.stringify(json, null, 2)}`;
      }
    } catch {
      // Fall through to JS parsing.
    }
  }

  // 2. Parse with both typescript and jsx so JSX-bearing helpers parse.
  let ast: parser.ParseResult<t.File>;
  try {
    ast = parser.parse(input, {
      sourceType: 'unambiguous',
      plugins: ['typescript', 'jsx'],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      output: `// Failed to parse input as JavaScript/TypeScript\n// Error: ${message}\n\n${input}`,
      warnings: [
        { type: 'manual', code: 'config.parseError', message: 'Failed to parse input. Ensure it is valid JavaScript or TypeScript.' },
      ],
      flags: emptyFlags(targetVitest),
    };
  }

  let configObject: t.ObjectExpression | null = null;
  let embeddedParent: 'vue.config' | 'craco.config' | null = null;
  let usedFunctionForm = false;
  let usedNextJest = false;

  // Heuristic: if a top-level config object has a `jest:` key plus parent-config indicators,
  // it's an embedded config. Extract the jest sub-object and remember which parent it came from.
  const VUE_INDICATORS = new Set(['devServer', 'configureWebpack', 'chainWebpack', 'pluginOptions', 'transpileDependencies']);
  const CRACO_INDICATORS = new Set(['craco', 'webpack', 'eslint', 'plugins', 'babel', 'style', 'devServer']);

  const tryExtractEmbeddedJest = (obj: t.ObjectExpression): t.ObjectExpression | null => {
    let jestProp: t.ObjectExpression | null = null;
    let vueHits = 0;
    let cracoHits = 0;
    obj.properties.forEach((p) => {
      if (!t.isObjectProperty(p) || p.computed) return;
      const name =
        t.isIdentifier(p.key) ? p.key.name :
        t.isStringLiteral(p.key) ? p.key.value : null;
      if (!name) return;
      if (name === 'jest' && t.isObjectExpression(p.value)) jestProp = p.value;
      if (VUE_INDICATORS.has(name)) vueHits++;
      if (CRACO_INDICATORS.has(name)) cracoHits++;
    });
    if (!jestProp) return null;
    if (vueHits >= 1 && vueHits >= cracoHits) embeddedParent = 'vue.config';
    else if (cracoHits >= 1) embeddedParent = 'craco.config';
    else embeddedParent = null;
    return jestProp;
  };

  // ---- Multi-statement static evaluation (never executes user code) ----
  let foldedAssignments = 0;
  let foldedConditional = false;

  const foldKey = (k: string) =>
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? t.identifier(k) : t.stringLiteral(k);

  // Fold `name.prop = value` member assignments into a copy of the object
  // literal. Later assignments win; same-named literal properties are removed
  // so the assembly step does not report a self-inflicted conflict.
  const applyFoldedProps = (
    obj: t.ObjectExpression,
    extras: Map<string, t.Expression>
  ): t.ObjectExpression => {
    if (extras.size === 0) return obj;
    foldedAssignments += extras.size;
    const kept = obj.properties.filter((p) => {
      if (!t.isObjectProperty(p) || p.computed) return true;
      const name =
        t.isIdentifier(p.key) ? p.key.name :
        t.isStringLiteral(p.key) ? p.key.value : null;
      return name == null || !extras.has(name);
    });
    const appended = [...extras.entries()].map(([k, v]) => t.objectProperty(foldKey(k), v));
    return t.objectExpression([...kept, ...appended]);
  };

  // Static evaluator for multi-statement function bodies:
  //   const config = {...}; config.x = y; if (cond) config.z = w; return config;
  // Assignments are read in order; if-guarded ones are folded unconditionally
  // and flagged so the verify warning calls them out.
  const resolveLocalConfig = (block: t.BlockStatement, name: string): t.ObjectExpression | null => {
    let base: t.ObjectExpression | null = null;
    const extras = new Map<string, t.Expression>();
    const collectAssignment = (expr: t.Node, conditional: boolean): void => {
      if (!t.isAssignmentExpression(expr) || expr.operator !== '=') return;
      const left = expr.left;
      if (!t.isMemberExpression(left) || left.computed) return;
      if (!t.isIdentifier(left.object, { name })) return;
      if (!t.isIdentifier(left.property)) return;
      extras.set(left.property.name, expr.right as t.Expression);
      if (conditional) foldedConditional = true;
    };
    for (const stmt of block.body) {
      if (t.isVariableDeclaration(stmt)) {
        for (const decl of stmt.declarations) {
          if (t.isIdentifier(decl.id, { name }) && decl.init) {
            const init =
              t.isTSAsExpression(decl.init) || t.isTSSatisfiesExpression(decl.init)
                ? decl.init.expression
                : decl.init;
            if (t.isObjectExpression(init)) base = init;
          }
        }
      } else if (t.isExpressionStatement(stmt)) {
        collectAssignment(stmt.expression, false);
      } else if (t.isIfStatement(stmt)) {
        const branches = [stmt.consequent, stmt.alternate].filter((b): b is t.Statement => b != null);
        for (const branch of branches) {
          const stmts = t.isBlockStatement(branch) ? branch.body : [branch];
          for (const s of stmts) {
            if (t.isExpressionStatement(s)) collectAssignment(s.expression, true);
          }
        }
      }
    }
    if (!base) return null;
    return applyFoldedProps(base, extras);
  };

  // Module-level variant: fold `config.x = y` statements found through the
  // binding's reference paths (covers `const config = {...}; config.x = y;
  // module.exports = config`).
  const foldBindingAssignments = (
    obj: t.ObjectExpression,
    binding: { referencePaths?: NodePath[] }
  ): t.ObjectExpression => {
    const extras = new Map<string, t.Expression>();
    for (const ref of binding.referencePaths ?? []) {
      const memberPath = ref.parentPath;
      if (!memberPath) continue;
      const member = memberPath.node;
      if (!t.isMemberExpression(member) || member.object !== ref.node || member.computed) continue;
      const assignPath = memberPath.parentPath;
      if (!assignPath) continue;
      const assign = assignPath.node;
      if (!t.isAssignmentExpression(assign) || assign.left !== member || assign.operator !== '=') continue;
      if (!t.isIdentifier(member.property)) continue;
      extras.set(member.property.name, assign.right as t.Expression);
      if (assignPath.findParent((p) => p.isIfStatement() || p.isConditionalExpression() || p.isLogicalExpression())) {
        foldedConditional = true;
      }
    }
    return applyFoldedProps(obj, extras);
  };

  // Unwrap function-form configs: () => ({...}), async () => ({...}), function() { return {...} }.
  const extractFromFunctionBody = (node: t.Node, scope?: Scope): t.ObjectExpression | null => {
    if (!t.isArrowFunctionExpression(node) && !t.isFunctionExpression(node)) return null;
    usedFunctionForm = true;
    const body = node.body;
    if (t.isObjectExpression(body)) return body;
    if (t.isBlockStatement(body)) {
      // Find a single ReturnStatement.
      const returns = body.body.filter((s) => t.isReturnStatement(s)) as t.ReturnStatement[];
      if (returns.length === 1 && returns[0].argument) {
        const arg = returns[0].argument;
        // Multi-statement body returning a locally-built object.
        if (t.isIdentifier(arg)) {
          const local = resolveLocalConfig(body, arg.name);
          if (local) return local;
        }
        const direct = extractObjectArg(arg, scope);
        if (direct) return direct;
      }
    }
    return null;
  };

  // Resolve the module source a local name was bound from (import or require).
  const moduleSourceOf = (name: string, scope: Scope): string | null => {
    const binding = scope.getBinding(name);
    if (!binding) return null;
    const bindingNode = binding.path.node;
    if (
      (t.isImportDefaultSpecifier(bindingNode) ||
        t.isImportSpecifier(bindingNode) ||
        t.isImportNamespaceSpecifier(bindingNode)) &&
      t.isImportDeclaration(binding.path.parent)
    ) {
      return binding.path.parent.source.value;
    }
    if (t.isVariableDeclarator(bindingNode) && bindingNode.init) {
      // const x = require('m') or require('m').default
      let init: t.Node = bindingNode.init;
      if (t.isMemberExpression(init)) init = init.object;
      if (
        t.isCallExpression(init) &&
        t.isIdentifier(init.callee, { name: 'require' }) &&
        init.arguments.length > 0 &&
        t.isStringLiteral(init.arguments[0])
      ) {
        return init.arguments[0].value;
      }
    }
    return null;
  };

  // True for `createJestConfig(...)` where createJestConfig was produced by a
  // factory imported from 'next/jest' (the shape the Next.js docs ship).
  const isNextJestWrapperCall = (call: t.CallExpression, scope: Scope): boolean => {
    if (!t.isIdentifier(call.callee)) return false;
    const binding = scope.getBinding(call.callee.name);
    if (!binding || !t.isVariableDeclarator(binding.path.node)) return false;
    const init = binding.path.node.init;
    if (!init || !t.isCallExpression(init) || !t.isIdentifier(init.callee)) return false;
    const source = moduleSourceOf(init.callee.name, scope);
    return source !== null && /^next\/jest(\.js)?$/.test(source);
  };

  // Guard against self-referential bindings (const a = a) during resolution.
  const resolvedIdentifiers = new Set<string>();

  const extractObjectArg = (node: t.Node | null | undefined, scope?: Scope): t.ObjectExpression | null => {
    if (!node) return null;
    if (t.isObjectExpression(node)) {
      const embedded = tryExtractEmbeddedJest(node);
      return embedded ?? node;
    }
    if (t.isCallExpression(node)) {
      if (scope && isNextJestWrapperCall(node, scope)) usedNextJest = true;
      const arg = node.arguments[0];
      if (arg && t.isObjectExpression(arg)) {
        const embedded = tryExtractEmbeddedJest(arg);
        return embedded ?? arg;
      }
      // createJestConfig(customJestConfig): resolve the identifier argument.
      if (arg && t.isIdentifier(arg)) {
        return extractObjectArg(arg, scope);
      }
    }
    if (t.isIdentifier(node) && scope) {
      if (resolvedIdentifiers.has(node.name)) return null;
      resolvedIdentifiers.add(node.name);
      const binding = scope.getBinding(node.name);
      if (binding && t.isVariableDeclarator(binding.path.node)) {
        const resolvedObj = extractObjectArg(binding.path.node.init, scope);
        if (resolvedObj) return foldBindingAssignments(resolvedObj, binding);
        return null;
      }
      return null;
    }
    if (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node)) {
      return extractObjectArg(node.expression, scope);
    }
    if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) {
      return extractFromFunctionBody(node, scope);
    }
    return null;
  };

  traverse(ast, {
    AssignmentExpression(path: NodePath<t.AssignmentExpression>) {
      if (configObject) return;
      const { node } = path;
      if (
        t.isMemberExpression(node.left) &&
        t.isIdentifier(node.left.object, { name: 'module' }) &&
        t.isIdentifier(node.left.property, { name: 'exports' })
      ) {
        const direct = extractObjectArg(node.right, path.scope);
        if (direct) configObject = direct;
      }
    },
    ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
      if (configObject) return;
      const direct = extractObjectArg(path.node.declaration, path.scope);
      if (direct) configObject = direct;
    },
  });

  if (!configObject) {
    return {
      output:
        `// Could not find a recognizable config object.\n` +
        `// Expected module.exports = {...}, export default {...}, a config identifier,\n` +
        `// a function returning a static object literal, or a parent config object with a 'jest' property.\n\n${input}`,
      warnings: [
        { type: 'manual', code: 'config.notFound', message: 'Could not detect Jest configuration object in the provided code.' },
      ],
      flags: emptyFlags(targetVitest),
    };
  }

  // Surface the input shape to the user so they understand what was extracted.
  if (usedFunctionForm) {
    pushWarning(
      'verify',
      'config.functionForm',
      `Detected a function-form config (e.g. module.exports = () => ({...})). The returned static object literal was extracted; any logic in the function body was dropped. Inline the values or call mergeConfig() if dynamic logic is needed.`
    );
  }
  if (foldedAssignments > 0) {
    pushWarning(
      'verify',
      'config.multiStatement',
      `${foldedAssignments} property assignment(s) (config.x = ...) were statically folded into the config object.${
        foldedConditional
          ? ' At least one was guarded by a condition and was folded unconditionally — verify the intended branch.'
          : ''
      }`
    );
  }
  if (embeddedParent === 'vue.config') {
    pushWarning(
      'verify',
      'config.embedded',
      `Detected an embedded 'jest' block inside a vue.config-style file. Only the 'jest' object was migrated. Move the rest of vue.config.js to its own file (it does not belong in vitest.config.ts).`
    );
  } else if (embeddedParent === 'craco.config') {
    pushWarning(
      'verify',
      'config.embedded',
      `Detected an embedded 'jest' block inside a craco.config-style file. Only the 'jest' object was migrated. CRACO's webpack/babel sections need separate Vite-equivalent migration.`
    );
  }
  if (usedNextJest) {
    pushWarning(
      'verify',
      'config.nextJest',
      `Detected a next/jest wrapper config. The inner Jest config object was converted, but the Next.js SWC preset also handled TS/JSX transforms, CSS module stubbing, and tsconfig path aliases implicitly. @vitejs/plugin-react and vite-tsconfig-paths were added to cover the common cases; CSS and next/image-style imports may still need mocks in a setup file.`
    );
  }

  // Output sections.
  const test = newSection();
  const coverage = newSection();
  const sequenceEntries = new Map<string, string>();
  const resolveAlias = new Map<string, string>(); // key (alias from) -> value (target)
  const resolveAliasRegex: Array<{ find: string; replacement: string }> = []; // regex-form aliases
  const resolveExtensions: string[] = [];
  const serverDepsInline: string[] = [];
  const rootServerWatchIgnored: string[] = []; // Vite server.watch.ignored (root level)
  const define = new Map<string, string>();
  const rootPlugins: string[] = [];
  const rootImports: string[] = [];
  const tailoredNextSteps: string[] = [];
  const detectedSetupFiles: string[] = [];

  // Detection flags for tailored next steps.
  let needsTsconfigPaths = false;
  let needsCoverage = false;
  let selectedCoverageProvider: 'v8' | 'istanbul' | 'custom' | null = null;
  let needsJsdom = false;
  let needsHappyDom = false;
  let needsSvgr = false;
  let usesGlobalsTrue = false;
  let hasMonorepoSignal = false;
  let pendingProjects: t.ArrayExpression | null = null;
  let pendingEnvOptions: t.Node | null = null;

  // Detection flags for behavioral migration warnings.
  let hasMockingSignal = false;
  let hasSetupFilesAfterEnv = false;
  let hasFrameworkSerializer = false;
  const looksLikeTypeScript = /\bsatisfies\s+\w/.test(input) || /:\s*Config\b/.test(input) || /\bas\s+Config\b/.test(input);

  const FRAMEWORK_SERIALIZERS = [
    'enzyme-to-json',
    'jest-serializer-vue',
    'jest-serializer-vue-tjw',
    '@vue/test-utils',
    'jsx-serializer',
    'vue-jest',
    '@emotion/jest',
    'jest-emotion',
  ];

  const stripRootDir = (code: string) => normalizeRootDirInCode(code);
  const getSourceCode = (node: t.Node) => stripRootDir(generate(node).code);
  const getCompactSourceCode = (node: t.Node) => stripRootDir(generate(node, { compact: true }).code);

  // Collect setup-file string literals (for flags.setupFiles, used by --apply
  // to rewrite the @testing-library/jest-dom import).
  const collectSetupPaths = (value: t.Node) => {
    const push = (p: string) => {
      const normalized = normalizeRootDir(p);
      if (!detectedSetupFiles.includes(normalized)) detectedSetupFiles.push(normalized);
    };
    if (t.isStringLiteral(value)) push(value.value);
    else if (t.isArrayExpression(value)) {
      value.elements.forEach((el) => {
        if (el && t.isStringLiteral(el)) push(el.value);
      });
    }
  };

  const getPropName = (node: t.ObjectProperty): string | null => {
    if (t.isIdentifier(node.key)) return node.key.name;
    if (t.isStringLiteral(node.key)) return node.key.value;
    if (t.isNumericLiteral(node.key)) return String(node.key.value);
    return null;
  };

  const setScalar = (section: ConfigSection, key: string, value: string) => {
    if (section.scalars.has(key)) {
      warnVerify(
        'config.conflict',
        `Multiple Jest fields map to '${key}'. Kept the latest value; review the input for conflicting settings.`
      );
    }
    section.scalars.set(key, value);
  };

  const setSequence = (key: string, value: string) => {
    if (sequenceEntries.has(key)) {
      warnVerify(
        'config.conflict',
        `Multiple Jest fields map to sequence.${key}. Kept the latest value; review the input for conflicting settings.`
      );
    }
    sequenceEntries.set(key, value);
  };

  // Shared by 'roots' and its deprecated alias 'testPathDirs'.
  const applyRoots = (value: t.Node, source: string) => {
    if (t.isArrayExpression(value)) {
      if (value.elements.length > 1) {
        warnInfo(
          'discovery.roots',
          `roots had ${value.elements.length} entries; Vitest test.dir takes a single directory. Kept the first. Use test.include for multi-root patterns.`
        );
      }
      if (value.elements[0]) setScalar(test, 'dir', getSourceCode(value.elements[0]));
    } else {
      setScalar(test, 'dir', source);
    }
  };

  // Shared by 'setupFilesAfterEnv' and its deprecated alias 'setupTestFrameworkScriptFile'.
  const applySetupFilesAfterEnv = (source: string, value: t.Node) => {
    collectSetupPaths(value);
    appendArray(test, 'setupFiles', source);
    hasSetupFilesAfterEnv = true;
    test.noteFor.set(
      'setupFiles',
      `VERIFY: includes setupFilesAfterEnv — runs BEFORE tests in Vitest (unlike Jest); move framework-dependent calls accordingly`
    );
    warnVerify(
      'setup.order',
      `setupFilesAfterEnv runs after the test framework in Jest; in Vitest setupFiles runs before tests. Move framework-dependent calls (e.g. expect.extend) into a setup that imports vitest first.`
    );
  };

  // Append items into an array-valued section field. Accepts an array literal source ("[a, b]")
  // and concatenates its element source codes; non-array sources are appended as-is.
  const appendArray = (section: ConfigSection, key: string, sourceArrayLiteralOrExpr: string) => {
    const existing = section.arrays.get(key) ?? [];
    const items = unpackArrayLiteral(sourceArrayLiteralOrExpr);
    section.arrays.set(key, [...existing, ...items]);
  };

  const properties = (configObject as t.ObjectExpression).properties;
  let hadDynamicProps = false;

  properties.forEach((prop) => {
    if (t.isSpreadElement(prop)) {
      hadDynamicProps = true;
      const exprSrc = getSourceCode(prop.argument);
      test.raw.push(`// MANUAL: spread '...${exprSrc}' could not be statically resolved. Inline its values or use mergeConfig().`);
      warnManual(
        'config.dynamic',
        `Spread '...${exprSrc}' was preserved as a // MANUAL comment. Vitest cannot reproduce dynamic spreads. Inline the values or call mergeConfig() from 'vitest/config'.`
      );
      return;
    }
    if (t.isObjectMethod(prop)) {
      hadDynamicProps = true;
      const name = t.isIdentifier(prop.key) ? prop.key.name : 'method';
      test.raw.push(`// MANUAL: object method '${name}' could not be converted to a static Vitest value.`);
      warnManual(
        'config.dynamic',
        `Object method '${name}' is not a static value. Replace it with a serializable expression or move to a setup file.`
      );
      return;
    }
    if (!t.isObjectProperty(prop)) {
      hadDynamicProps = true;
      return;
    }
    if (prop.computed) {
      hadDynamicProps = true;
      const keySrc = getSourceCode(prop.key);
      const valSrc = getSourceCode(prop.value as t.Node);
      test.raw.push(`// MANUAL: computed key [${keySrc}]: ${valSrc}`);
      warnManual(
        'config.dynamic',
        `Computed key '[${keySrc}]' is not statically analyzable. Resolve it to a literal property name.`
      );
      return;
    }

    const key = getPropName(prop);
    if (!key) return;
    const value = prop.value as t.Node;
    const source = getSourceCode(value);

    switch (key) {
      case 'testMatch':
        appendArray(test, 'include', source);
        break;
      case 'testRegex':
        handleTestRegex(value, test, '');
        break;
      case 'testPathIgnorePatterns':
        handleRegexIgnorePatterns(value, test, 'exclude', 'testPathIgnorePatterns');
        break;
      case 'testPathDirs':
        warnInfo(
          'discovery.deprecatedAlias',
          `testPathDirs is a deprecated Jest field name (renamed to roots in Jest 18). Treated as roots.`
        );
        applyRoots(value, source);
        break;
      case 'roots':
        applyRoots(value, source);
        break;
      case 'testEnvironment':
        applyTestEnvironment(test, value, source);
        break;
      case 'testEnvironmentOptions':
        // Applied at assembly so the environment name is known regardless of key order.
        pendingEnvOptions = value;
        break;
      case 'testURL': {
        const urlSrc = source;
        setScalar(test, 'environmentOptions', `{ jsdom: { url: ${urlSrc} } }`);
        test.noteFor.set('environmentOptions', `VERIFY: from testURL — merge manually if you also use testEnvironmentOptions`);
        warnVerify(
          'env.url',
          `testURL was migrated to environmentOptions.jsdom.url. If you also have testEnvironmentOptions, merge them manually.`
        );
        break;
      }
      case 'testTimeout':
      case 'maxConcurrency':
      case 'silent':
        setScalar(test, key, source);
        break;
      case 'globalSetup': {
        setScalar(test, key, source);
        const checkExt = (p: string) => {
          if (/\.(js|cjs)$/.test(p)) {
            test.noteFor.set(
              'globalSetup',
              `VERIFY: '${p}' likely uses module.exports — Vitest expects ESM default export`
            );
            warnVerify(
              'setup.globalSetup',
              `globalSetup '${p}' uses a CommonJS extension (.js/.cjs). Vitest expects an ESM default export, or named 'setup'/'teardown' exports. Convert 'module.exports = fn' to 'export default fn' (or rename to .mjs/.ts).`
            );
            return true;
          }
          return false;
        };
        if (t.isStringLiteral(value)) checkExt(value.value);
        else if (t.isArrayExpression(value)) {
          value.elements.forEach((el) => {
            if (t.isStringLiteral(el)) checkExt(el.value);
          });
        }
        break;
      }
      case 'slowTestThreshold':
        if (t.isNumericLiteral(value)) {
          setScalar(test, 'slowTestThreshold', String(value.value * 1000));
          warnInfo('config.unmapped', `slowTestThreshold was converted from Jest seconds to Vitest milliseconds.`);
        } else {
          test.raw.push(`// MANUAL: slowTestThreshold: ${source},`);
          warnManual('config.dynamic', `slowTestThreshold is not a static number. Convert Jest seconds to Vitest milliseconds manually.`);
        }
        break;
      case 'bail':
        if (t.isBooleanLiteral(value)) {
          setScalar(test, 'bail', value.value ? '1' : '0');
          warnInfo('config.unmapped', `bail ${source} was normalized to Vitest's numeric bail setting.`);
        } else {
          setScalar(test, 'bail', source);
        }
        break;
      case 'globalTeardown':
        test.raw.push(`// MANUAL: globalTeardown: ${source},`);
        warnManual(
          'setup.globalTeardown',
          `globalTeardown has no separate Vitest config key. Export teardown from a globalSetup file or return a teardown function from the setup module.`
        );
        break;
      case 'clearMocks':
      case 'restoreMocks':
        hasMockingSignal = true;
        setScalar(test, key, source);
        break;
      case 'snapshotSerializers':
        appendArray(test, 'snapshotSerializers', source);
        if (t.isArrayExpression(value)) {
          value.elements.forEach((el) => {
            if (t.isStringLiteral(el) && FRAMEWORK_SERIALIZERS.some((s) => el.value.includes(s))) {
              hasFrameworkSerializer = true;
            }
          });
        }
        break;
      case 'snapshotFormat':
        setScalar(test, 'snapshotFormat', source);
        if (t.isObjectExpression(value)) {
          const unsupported = value.properties
            .filter((p): p is t.ObjectProperty => t.isObjectProperty(p))
            .map((p) => ({ key: getPropName(p), value: p.value }))
            .filter(({ key, value }) =>
              key === 'plugins' || (key === 'compareKeys' && !t.isNullLiteral(value))
            )
            .map(({ key }) => key);
          if (unsupported.length > 0) {
            warnVerify(
              'snapshot.format',
              `snapshotFormat.${unsupported.join(', ')} is not supported by Vitest snapshotFormat. Use snapshotSerializers or set compareKeys: null where applicable.`
            );
          }
        }
        break;
      case 'prettierPath':
        warnInfo('snapshot.format', `prettierPath has no Vitest equivalent. Vitest uses an internal serializer; remove if no longer needed.`);
        break;
      case 'setupTestFrameworkScriptFile':
        warnInfo(
          'discovery.deprecatedAlias',
          `setupTestFrameworkScriptFile is a deprecated Jest field name (renamed to setupFilesAfterEnv in Jest 24). Treated as setupFilesAfterEnv.`
        );
        applySetupFilesAfterEnv(t.isArrayExpression(value) ? source : `[${source}]`, value);
        break;
      case 'setupFiles':
        collectSetupPaths(value);
        appendArray(test, 'setupFiles', source);
        break;
      case 'setupFilesAfterEnv':
        applySetupFilesAfterEnv(source, value);
        break;
      case 'collectCoverage':
        if (t.isBooleanLiteral(value)) {
          setScalar(coverage, 'enabled', String(value.value));
          needsCoverage = needsCoverage || value.value;
        } else {
          setScalar(coverage, 'enabled', source);
          needsCoverage = true;
        }
        break;
      case 'collectCoverageFrom':
        handleCoverageIncludePatterns(value, source);
        needsCoverage = true;
        break;
      case 'coverageDirectory':
        setScalar(coverage, 'reportsDirectory', source);
        needsCoverage = true;
        break;
      case 'coverageReporters':
        setScalar(coverage, 'reporter', source);
        needsCoverage = true;
        break;
      case 'coverageThreshold':
        handleCoverageThreshold(value, source);
        needsCoverage = true;
        warnVerify(
          'coverage.thresholds',
          `coverageThreshold is present. Vitest 4's V8 AST remapping may shift previously-passing thresholds. Re-baseline after migration.`
        );
        break;
      case 'coveragePathIgnorePatterns':
        handleRegexIgnorePatterns(value, coverage, 'exclude', 'coveragePathIgnorePatterns');
        needsCoverage = true;
        break;
      case 'forceCoverageMatch':
        appendArray(coverage, 'include', source);
        needsCoverage = true;
        break;
      case 'coverageProvider':
        if (t.isStringLiteral(value)) {
          if (value.value === 'babel') {
            setScalar(coverage, 'provider', `'istanbul'`);
            selectedCoverageProvider = 'istanbul';
            warnInfo('coverage.provider', `coverageProvider: 'babel' was mapped to Vitest's 'istanbul' coverage provider.`);
          } else if (value.value === 'v8' || value.value === 'istanbul' || value.value === 'custom') {
            setScalar(coverage, 'provider', source);
            selectedCoverageProvider = value.value;
            if (value.value === 'custom') {
              warnManual('coverage.provider', `coverageProvider: 'custom' requires a Vitest custom coverage provider module.`);
            }
          } else {
            coverage.raw.push(`// MANUAL: coverage provider ${source} is not valid in Vitest.`);
            warnManual(
              'coverage.provider',
              `coverageProvider ${source} is not valid in Vitest. Use 'v8', 'istanbul', or 'custom'.`
            );
          }
        } else {
          coverage.raw.push(`// MANUAL: coverage provider ${source} could not be statically converted.`);
          warnManual('coverage.provider', `coverageProvider value ${source} could not be statically converted.`);
        }
        needsCoverage = true;
        break;
      case 'moduleNameMapper':
        if (t.isObjectExpression(value)) {
          handleModuleNameMapper(value);
        } else if (
          t.isCallExpression(value) &&
          t.isIdentifier(value.callee, { name: 'pathsToModuleNameMapper' })
        ) {
          needsTsconfigPaths = true;
        } else {
          warnManual(
            'resolve.alias',
            `moduleNameMapper is a non-object expression. Inline its values or replace with resolve.alias entries.`
          );
        }
        break;
      case 'moduleFileExtensions':
        if (t.isArrayExpression(value)) {
          value.elements.forEach((el) => {
            if (t.isStringLiteral(el)) resolveExtensions.push(el.value);
          });
        } else {
          warnVerify('resolve.extensions', `moduleFileExtensions value was not a static array. Copy to resolve.extensions manually.`);
        }
        break;
      case 'moduleDirectories':
        setScalar(test, 'deps', `{ moduleDirectories: ${source} }`);
        test.noteFor.set('deps', `VERIFY: source aliasing belongs in resolve.alias; this controls mock/dependency resolution only`);
        warnVerify(
          'resolve.moduleDirectories',
          `moduleDirectories was migrated to test.deps.moduleDirectories. Verify if you intended source resolution (use resolve.alias) versus mock/dependency resolution (test.deps.moduleDirectories).`
        );
        break;
      case 'modulePaths':
        warnManual(
          'resolve.modulePaths',
          `modulePaths has no direct Vitest equivalent. For source aliasing add entries to resolve.alias; for dependency resolution use test.deps.moduleDirectories.`
        );
        break;
      case 'preset':
        if (t.isStringLiteral(value) && (value.value === 'ts-jest' || value.value.includes('ts-jest'))) {
          warnInfo('transform.preset', `preset '${value.value}' removed. Vitest handles TypeScript natively.`);
        } else if (t.isStringLiteral(value) && value.value.includes('babel-jest')) {
          warnInfo('transform.preset', `preset '${value.value}' removed. Vite handles transformation.`);
        } else if (t.isStringLiteral(value) && value.value.startsWith('.')) {
          hasMonorepoSignal = true;
          warnManual(
            'transform.preset',
            `Relative preset '${value.value}' detected. In Vitest, share config via mergeConfig() from 'vitest/config' rather than presets.`
          );
        } else {
          warnManual('transform.preset', `preset ${source} has no direct Vitest equivalent.`);
        }
        break;
      case 'transform':
        handleTransform(value);
        break;
      case 'transformIgnorePatterns':
        if (t.isArrayExpression(value)) {
          value.elements.forEach((el) => {
            if (!t.isStringLiteral(el)) return;
            const pkgs = extractPackagesFromIgnorePattern(el.value);
            pkgs.forEach((p) => {
              if (!serverDepsInline.includes(p)) serverDepsInline.push(p);
            });
            if (pkgs.length === 0) {
              warnVerify(
                'transform.ignorePatterns',
                `transformIgnorePatterns entry ${JSON.stringify(el.value)} could not be parsed into package names. Add packages manually to test.server.deps.inline.`
              );
            }
          });
        } else {
          warnVerify('transform.ignorePatterns', `transformIgnorePatterns was not a static array. Translate to test.server.deps.inline manually.`);
        }
        break;
      case 'automock':
        if (t.isBooleanLiteral(value)) {
          if (value.value) {
            hasMockingSignal = true;
            warnManual(
              'mocks.automock',
              `automock: true has no direct Vitest flag. Vitest auto-mocks only files inside __mocks__ adjacent to the source. Call vi.mock() per module instead.`
            );
            warnVerify(
              'mocks.automock',
              `Unlike Jest, Vitest does not auto-load root __mocks__ files unless vi.mock() is called. Put always-on mocks in setupFiles or add explicit vi.mock() calls.`
            );
          } else {
            warnInfo('mocks.automock', `automock: false omitted. Vitest does not automock modules by default.`);
          }
        } else {
          hasMockingSignal = true;
          warnManual('mocks.automock', `automock value ${source} could not be statically interpreted. Convert to per-module vi.mock() calls.`);
        }
        break;
      case 'resetMocks':
        hasMockingSignal = true;
        setScalar(test, 'mockReset', source);
        test.noteFor.set('mockReset', `VERIFY: mapped from Jest resetMocks — verify mock implementation reset semantics`);
        warnVerify('mocks.reset', `resetMocks was mapped to Vitest mockReset. Verify mock implementation reset behavior on first run.`);
        break;
      case 'fakeTimers':
        if (t.isObjectExpression(value)) {
          let legacy = false;
          let enableGlobally: boolean | null = null;
          const keep: t.ObjectProperty[] = [];
          value.properties.forEach((p) => {
            if (!t.isObjectProperty(p)) {
              warnManual('timers.fake', `fakeTimers contains a non-static property that could not be converted.`);
              return;
            }
            const subKey = getPropName(p);
            if (subKey === 'legacyFakeTimers' && t.isBooleanLiteral(p.value)) {
              legacy = p.value.value;
              return;
            }
            if (subKey === 'enableGlobally' && t.isBooleanLiteral(p.value)) {
              enableGlobally = p.value.value;
              return;
            }
            if (subKey && VITEST_FAKE_TIMER_OPTIONS.has(subKey)) {
              keep.push(p);
              return;
            }
            warnVerify(
              'timers.fake',
              `fakeTimers.${subKey ?? 'unknown'} is not a Vitest fakeTimers config option. Move equivalent behavior to vi.useFakeTimers() or a setup file.`
            );
          });
          if (legacy) {
            warnManual('timers.legacy', `fakeTimers.legacyFakeTimers has no equivalent in Vitest. Migrate timer usage to the modern fake timers API.`);
          }
          if (enableGlobally === true) {
            warnManual(
              'timers.fake',
              `fakeTimers.enableGlobally: true cannot be represented as Vitest config. Add a setupFiles entry that imports vi from 'vitest' and calls vi.useFakeTimers() if global fake timers are still required.`
            );
          }
          if (enableGlobally === false) {
            warnInfo('timers.fake', `fakeTimers.enableGlobally: false omitted. Vitest only installs fake timers when vi.useFakeTimers() is called.`);
          }
          if (keep.length > 0) {
            setScalar(test, 'fakeTimers', `{ ${keep.map((p) => generate(p).code).join(', ')} }`);
          }
        } else {
          warnManual('timers.fake', `fakeTimers value ${source} is not a static object. Verify the migration manually.`);
        }
        break;
      case 'timers':
        if (t.isStringLiteral(value) && value.value === 'legacy') {
          warnManual(
            'timers.legacy',
            `timers: 'legacy' has no Vitest equivalent. Replace with modern fake timers (vi.useFakeTimers()) in tests that need them.`
          );
        } else if (t.isStringLiteral(value) && value.value === 'fake') {
          warnManual(
            'timers.fake',
            `timers: 'fake' globally installed fake timers in Jest. Vitest has no config flag for this; call vi.useFakeTimers() in setupFiles or individual tests.`
          );
        } else {
          warnInfo('timers.fake', `timers: ${source} has no direct mapping. Use vi.useFakeTimers() per test instead.`);
        }
        break;
      case 'maxWorkers': {
        setScalar(test, 'maxWorkers', source);
        const isOne = t.isNumericLiteral(value) && value.value === 1;
        if (isOne) {
          setScalar(test, 'isolate', 'false');
          warnVerify('workers.maxWorkers', `maxWorkers: 1 detected. Added isolate: false to avoid the 2x slowdown observed in Vitest 4.`);
        }
        break;
      }
      case 'runInBand':
        setScalar(test, 'maxWorkers', '1');
        setScalar(test, 'isolate', 'false');
        warnInfo('workers.maxWorkers', `runInBand is a Jest CLI flag. Mapped to maxWorkers: 1, isolate: false.`);
        break;
      case 'workerThreads':
        if (t.isBooleanLiteral(value) && value.value === true) {
          setScalar(test, 'pool', `'threads'`);
          warnInfo('workers.pool', `workerThreads: true (Jest 30) was mapped to Vitest pool: 'threads'.`);
        } else if (t.isBooleanLiteral(value) && value.value === false) {
          warnInfo('workers.pool', `workerThreads: false omitted. Vitest's default pool ('forks') already uses child processes.`);
        } else {
          warnVerify('workers.pool', `workerThreads value ${source} could not be statically interpreted. Set test.pool ('threads' or 'forks') manually.`);
        }
        break;
      case 'workerIdleMemoryLimit':
        setScalar(test, 'vmMemoryLimit', source);
        test.noteFor.set('vmMemoryLimit', `VERIFY: only applies when pool: 'vmThreads' is set (not the default pool)`);
        warnVerify(
          'workers.memoryLimit',
          `workerIdleMemoryLimit was mapped to vmMemoryLimit, which only applies to the non-default 'vmThreads' pool. Set test.pool: 'vmThreads' if you rely on memory-based worker recycling, or drop the setting.`
        );
        break;
      case 'verbose':
        if (t.isBooleanLiteral(value) && value.value === true) {
          appendArray(test, 'reporters', `['verbose']`);
        } else if (t.isBooleanLiteral(value) && value.value === false) {
          appendArray(test, 'reporters', `['default']`);
        } else {
          warnInfo('reporters.verbatim', `verbose value ${source} could not be mapped. Set test.reporters explicitly.`);
        }
        break;
      case 'reporters':
        handleReporters(value, source);
        break;
      case 'testSequencer':
        test.raw.push(`// MANUAL: testSequencer: ${source},`);
        warnManual(
          'sequence.sequencer',
          `testSequencer cannot be copied directly. Vitest's sequence.sequencer expects a Vitest-compatible sequencer constructor from 'vitest/node'. Port the sequencer module manually.`
        );
        break;
      case 'randomize':
        if (t.isBooleanLiteral(value)) {
          setSequence('shuffle', String(value.value));
          warnInfo('sequence.shuffle', `randomize was mapped to Vitest sequence.shuffle.`);
        } else {
          test.raw.push(`// MANUAL: randomize: ${source},`);
          warnManual('sequence.shuffle', `randomize value ${source} could not be statically converted to sequence.shuffle.`);
        }
        break;
      case 'showSeed':
        if (t.isBooleanLiteral(value) && value.value) {
          warnInfo('sequence.seed', `showSeed: true has no direct Vitest config equivalent. Use Vitest's seed/sequence options and CLI output when reproducing shuffled runs.`);
        } else if (t.isBooleanLiteral(value)) {
          warnInfo('sequence.seed', `showSeed: false omitted.`);
        } else {
          warnVerify('sequence.seed', `showSeed value ${source} could not be statically interpreted. Review Vitest seed output manually.`);
        }
        break;
      case 'detectOpenHandles':
      case 'detectLeaks':
        warnVerify(
          'workers.detect',
          `${key} has no direct Vitest flag. Run with --logHeapUsage and consider the verbose reporter to surface stuck handles or leaks.`
        );
        break;
      case 'poolOptions':
        if (targetVitest === 3) {
          // poolOptions still exists in Vitest 3; copy it through.
          setScalar(test, 'poolOptions', source);
          warnVerify(
            'workers.pool',
            `poolOptions was copied verbatim (valid in Vitest 3, removed in Vitest 4). Verify each option against the Vitest 3 docs.`
          );
          break;
        }
        if (t.isObjectExpression(value)) {
          let mappedSingle = false;
          value.properties.forEach((p) => {
            if (!t.isObjectProperty(p)) return;
            const poolKey = getPropName(p);
            if ((poolKey === 'threads' || poolKey === 'forks') && t.isObjectExpression(p.value)) {
              p.value.properties.forEach((sub) => {
                if (!t.isObjectProperty(sub)) return;
                const subKey = getPropName(sub);
                if ((subKey === 'singleThread' || subKey === 'singleFork') && t.isBooleanLiteral(sub.value) && sub.value.value) {
                  setScalar(test, 'maxWorkers', '1');
                  setScalar(test, 'isolate', 'false');
                  mappedSingle = true;
                }
              });
            }
          });
          warnInfo(
            'workers.pool',
            mappedSingle
              ? `poolOptions was removed in Vitest 4. Mapped singleThread/singleFork to maxWorkers: 1, isolate: false.`
              : `poolOptions was removed in Vitest 4. Move equivalent settings to the top-level test config (maxWorkers, isolate, pool).`
          );
        } else {
          warnInfo('workers.pool', `poolOptions was removed in Vitest 4. Move equivalent settings to top-level test config.`);
        }
        break;
      case 'watchPathIgnorePatterns':
        handleWatchPathIgnorePatterns(value, source);
        break;
      case 'unmockedModulePathPatterns':
        hasMockingSignal = true;
        warnManual('field.noEquivalent', `${key} has no equivalent in Vitest.`);
        break;
      case 'watchPlugins':
        warnManual('watch.plugins', `${key} has no equivalent in Vitest.`);
        break;
      case 'testRunner':
      case 'dependencyExtractor':
      case 'haste':
      case 'resolver':
        warnManual('field.noEquivalent', `${key} has no equivalent in Vitest.`);
        break;
      case 'globals':
        if (t.isObjectExpression(value)) {
          handleGlobalsObject(value);
        } else if (t.isBooleanLiteral(value) && value.value === true) {
          setScalar(test, 'globals', 'true');
          usesGlobalsTrue = true;
          warnInfo(
            'globals.true',
            `globals: true is set. Note: this does not auto-cleanup Testing Library DOM. Call cleanup() explicitly or import @testing-library/jest-dom/vitest.`
          );
        } else {
          setScalar(test, 'globals', source);
        }
        break;
      case 'injectGlobals':
        if (t.isBooleanLiteral(value)) {
          if (value.value) {
            setScalar(test, 'globals', 'true');
            usesGlobalsTrue = true;
            warnInfo('globals.true', `injectGlobals: true was mapped to Vitest globals: true.`);
          } else {
            warnInfo('globals.true', `injectGlobals: false omitted. Vitest uses explicit imports by default.`);
          }
        } else {
          test.raw.push(`// MANUAL: injectGlobals: ${source},`);
          warnManual('globals.true', `injectGlobals value ${source} could not be statically converted.`);
        }
        break;
      case 'extensionsToTreatAsEsm':
      case 'errorOnDeprecated':
      case 'testFailureExitCode':
      case 'notify':
      case 'notifyMode':
      case 'sandboxInjectedGlobals':
      case 'minWorkers':
      case 'poolMatchGlobs':
      case 'environmentMatchGlobs':
        warnInfo('field.removed', `${key} is unnecessary or removed in Vitest 4.`);
        break;
      case 'projects':
        if (t.isArrayExpression(value)) {
          pendingProjects = value;
          warnVerify(
            'projects.remapped',
            `projects entries were remapped to Vitest's { test: { ... } } shape. Neither Jest nor Vitest inherits root options into projects by default; add extends: true to a project if it should inherit the root config.`
          );
        } else {
          test.raw.push(`// MANUAL: projects: ${source},`);
          warnManual('projects.dynamic', `projects is not a static array and could not be converted. Define test.projects manually.`);
        }
        hasMonorepoSignal = true;
        if (targetVitest === 3) {
          warnInfo(
            'projects.inline',
            `Targeting Vitest 3: projects were emitted under test.workspace (renamed to test.projects in Vitest 3.2). A vitest.workspace.ts file also works in 3.x but is deprecated.`
          );
        } else {
          warnInfo('projects.inline', `In Vitest 4, workspaces must be inline via test.projects. Do not generate a vitest.workspace.ts file.`);
        }
        break;
      case 'displayName':
        setScalar(test, 'name', source);
        break;
      case 'cacheDirectory':
      case 'cache':
        warnInfo('field.removed', `${key} is managed by Vite/Vitest internally; usually safe to drop.`);
        break;
      case 'modulePathIgnorePatterns':
        test.raw.push(`// MANUAL: modulePathIgnorePatterns: ${source},`);
        warnManual(
          'resolve.modulePaths',
          `modulePathIgnorePatterns has no direct Vitest equivalent. Review whether these paths should be excluded from test.include/test.exclude, coverage.exclude, or Vite resolution.`
        );
        break;
      case 'resetModules':
        warnVerify(
          'mocks.modules',
          `resetModules controls Jest's module registry reset behavior. Vitest has vi.resetModules() for per-test use; verify module isolation expectations manually.`
        );
        break;
      case 'snapshotResolver':
        test.raw.push(`// MANUAL: snapshotResolver: ${source},`);
        warnManual(
          'snapshot.resolver',
          `snapshotResolver cannot be copied directly. Vitest uses resolveSnapshotPath with a different function signature; port the resolver manually.`
        );
        break;
      case 'testResultsProcessor':
        test.raw.push(`// MANUAL: testResultsProcessor: ${source},`);
        warnManual(
          'reporters.processor',
          `testResultsProcessor has no direct Vitest equivalent. Replace it with a Vitest reporter or post-processing step.`
        );
        break;
      case 'waitForUnhandledRejections':
        warnVerify(
          'field.noEquivalent',
          `waitForUnhandledRejections has no direct Vitest config equivalent. Vitest handles unhandled rejections differently; verify async rejection failures on first run.`
        );
        break;
      default:
        test.raw.push(`// UNMAPPED: ${key}: ${source},`);
        warnManual('config.unmapped', `Unmapped Jest field '${key}' was preserved as a comment. Review and migrate manually.`);
    }
  });

  // Coverage subsection cleanup: nested coverage.all / coverage.ignoreEmptyLines flags from Jest
  // are not nested under top-level keys in Jest itself — we surface guidance only when the user
  // had a Vitest-style coverage object passed through. For Jest input there is no nested
  // coverage object, so we skip that. We do, however, warn for legacy Vitest carryover values
  // when scanning the raw input for these tokens.
  if (/\bcoverage\.all\b/.test(input) || /coverage:\s*{[^}]*\ball:/.test(input)) {
    warnInfo('coverage.removed', `coverage.all was removed in Vitest 4. Replace with coverage.include patterns.`);
  }
  if (/\bcoverage\.ignoreEmptyLines\b/.test(input) || /coverage:\s*{[^}]*\bignoreEmptyLines:/.test(input)) {
    warnInfo('coverage.removed', `coverage.ignoreEmptyLines was removed in Vitest 4 (always true).`);
  }

  // ---- Behavioral migration warnings (apply regardless of mapped fields). ----
  // These cover Jest-vs-Vitest semantic differences that the config alone cannot fully express.

  // 1. vi.mock factory hoisting — surfaced when any mocking-related signal is present.
  if (hasMockingSignal) {
    warnVerify(
      'mocks.hoisting',
      `vi.mock() factories are hoisted to the top of the file. Variables declared in the surrounding scope are NOT available inside the factory. Wrap them with vi.hoisted() or move them inside the factory.`
    );
  }

  // 2. Hook execution order — surfaced when setup files or global hooks are present.
  if (hasSetupFilesAfterEnv || test.scalars.has('globalSetup') || test.scalars.has('globalTeardown')) {
    warnInfo(
      'behavior.hooks',
      `Hook execution order: Vitest defaults to parallel hook execution within a file. If your tests rely on Jest's strict sequential beforeAll/beforeEach order, set sequence.hooks: 'list' on the test config.`
    );
  }

  // 3. done callback removal — surfaced when legacy setup patterns are likely.
  if (hasSetupFilesAfterEnv) {
    warnInfo(
      'setup.done',
      `Vitest does not support the 'done' callback in tests or hooks. Convert any 'done' usage to async/await or return a promise.`
    );
  }

  // 4. expect.getState().currentTestName separator change — generic behavioral note.
  warnInfo(
    'behavior.currentTestName',
    `If any code reads expect.getState().currentTestName, note Jest joins describe/test names with a space while Vitest uses ' > '. Adjust string-matching logic accordingly.`
  );

  // 5. Framework-specific snapshot serializer warning.
  if (hasFrameworkSerializer) {
    warnVerify(
      'snapshot.serializers',
      `Framework-specific snapshot serializer detected (e.g. enzyme-to-json, jest-serializer-vue). Verify the snapshot output is byte-identical under Vitest. Some serializers depend on Jest internals and may need a Vitest-compatible replacement.`
    );
  }

  // 6. No 'jest' namespace types — important for TypeScript users.
  if (looksLikeTypeScript || usesGlobalsTrue) {
    warnInfo(
      'behavior.jestNamespace',
      `Vitest has no global 'jest' namespace. Replace 'jest.fn()', 'jest.spyOn()', 'jest.mock()', and 'jest.Mock' types with the equivalent 'vi' import from 'vitest', and update tsconfig types accordingly.`
    );
  }

  // Snapshot regeneration is an informational note — it's an action the user runs
  // (vitest run --update), not a semantic mismatch they need to verify.
  warnInfo('snapshot.regen', `Snapshot regeneration is required on first run (format change from Jest).`);

  // ---- Output assembly ----
  if (needsTsconfigPaths) {
    rootImports.push(`import tsconfigPaths from 'vite-tsconfig-paths';`);
    rootPlugins.push(`tsconfigPaths()`);
    warnManual('resolve.tsconfigPaths', `pathsToModuleNameMapper detected. Included vite-tsconfig-paths. Run: ${pm.add('vite-tsconfig-paths')}`);
  }
  if (usedNextJest) {
    rootImports.unshift(`import react from '@vitejs/plugin-react';`);
    rootPlugins.unshift(`react()`);
    if (!needsTsconfigPaths) {
      // next/jest applied tsconfig path aliases implicitly; keep that behavior.
      rootImports.push(`import tsconfigPaths from 'vite-tsconfig-paths';`);
      rootPlugins.push(`tsconfigPaths()`);
      needsTsconfigPaths = true;
    }
  }

  // Build define output.
  const defineEntries = Array.from(define.entries()).map(([k, v]) => `${quoteKey(k)}: ${v}`);

  // Build coverage block (only if any coverage entries).
  if (pendingEnvOptions) {
    applyEnvironmentOptions(test, pendingEnvOptions, '');
  }

  const coverageLines = renderSection(coverage, '  ', format);
  if (coverageLines.length > 0) {
    test.raw.push('coverage: {');
    coverageLines.forEach((line) => test.raw.push(line));
    test.raw.push('},');
  }

  if (pendingProjects) {
    renderProjectsLines(pendingProjects).forEach((line) => test.raw.push(line));
  }

  if (sequenceEntries.size > 0) {
    test.raw.push(`sequence: { ${Array.from(sequenceEntries.entries()).map(([k, v]) => `${quoteKey(k)}: ${v}`).join(', ')} },`);
  }

  // Build server.deps.inline if we have any.
  let serverBlock = '';
  if (serverDepsInline.length > 0) {
    serverBlock = `server: { deps: { inline: [${serverDepsInline.map((p) => `'${p}'`).join(', ')}] } }`;
    test.raw.push(`${serverBlock},`);
  }

  // Compose root test block.
  const testLines = renderSection(test, '    ', format);

  // Compose imports.
  const imports: string[] = [];
  imports.push(
    mode === 'standalone'
      ? `import { defineConfig } from 'vitest/config';`
      : `/// <reference types="vitest/config" />\nimport { defineConfig } from 'vite';`
  );
  imports.push(...rootImports);

  const lines: string[] = [];
  lines.push(...imports);
  lines.push('');
  lines.push(`export default defineConfig({`);

  if (rootPlugins.length > 0) {
    lines.push(`  plugins: [${rootPlugins.join(', ')}],`);
  }
  if (defineEntries.length > 0) {
    lines.push(`  define: {`);
    defineEntries.forEach((entry) => lines.push(`    ${entry},`));
    lines.push(`  },`);
  }
  if (resolveAlias.size > 0 || resolveAliasRegex.length > 0 || resolveExtensions.length > 0) {
    lines.push(`  resolve: {`);
    if (resolveAliasRegex.length > 0) {
      // Vite accepts the array alias form; regex finds cannot be object keys.
      lines.push(`    alias: [`);
      resolveAlias.forEach((target, alias) => {
        const formattedTarget = format ? prettyFormat(target, '      ') : target;
        lines.push(`      { find: ${quoteAliasFind(alias)}, replacement: ${formattedTarget} },`);
      });
      resolveAliasRegex.forEach(({ find, replacement }) => {
        lines.push(`      { find: ${find}, replacement: ${replacement} },`);
      });
      lines.push(`    ],`);
    } else if (resolveAlias.size > 0) {
      lines.push(`    alias: {`);
      resolveAlias.forEach((target, alias) => {
        const formattedTarget = format ? prettyFormat(target, '      ') : target;
        lines.push(`      ${quoteKey(alias)}: ${formattedTarget},`);
      });
      lines.push(`    },`);
    }
    if (resolveExtensions.length > 0) {
      const ext = resolveExtensions.map((e) => `'${e.startsWith('.') ? e : `.${e}`}'`).join(', ');
      lines.push(`    extensions: [${ext}],`);
    }
    lines.push(`  },`);
  }
  if (rootServerWatchIgnored.length > 0) {
    lines.push(`  server: {`);
    lines.push(`    watch: { ignored: [${rootServerWatchIgnored.map((g) => `'${g}'`).join(', ')}] }, // from watchPathIgnorePatterns`);
    lines.push(`  },`);
  }
  if (testLines.length > 0) {
    lines.push(`  test: {`);
    testLines.forEach((line) => lines.push(line));
    lines.push(`  },`);
  }
  lines.push(`});`);

  // Tailored next steps (commands follow the detected/selected package manager).
  const versioned = (pkg: string) => (targetVitest === 3 ? `${pkg}@^3` : pkg);
  tailoredNextSteps.push(pm.remove('jest @types/jest ts-jest babel-jest'));
  tailoredNextSteps.push(pm.add(versioned('vitest')));
  if (needsCoverage && selectedCoverageProvider !== 'custom') {
    tailoredNextSteps.push(
      pm.add(versioned(selectedCoverageProvider === 'istanbul' ? '@vitest/coverage-istanbul' : '@vitest/coverage-v8'))
    );
  }
  if (needsJsdom) tailoredNextSteps.push(pm.add('jsdom'));
  if (needsHappyDom) tailoredNextSteps.push(pm.add('happy-dom'));
  if (needsTsconfigPaths) tailoredNextSteps.push(pm.add('vite-tsconfig-paths'));
  if (usedNextJest) tailoredNextSteps.push(pm.add('@vitejs/plugin-react'));
  if (needsSvgr) tailoredNextSteps.push(pm.add('vite-plugin-svgr'));
  tailoredNextSteps.push(`Update package.json scripts: "test": "vitest"`);
  if (usesGlobalsTrue) {
    tailoredNextSteps.push(`Add "vitest/globals" to compilerOptions.types in tsconfig.json`);
  }
  if (hasMonorepoSignal) {
    tailoredNextSteps.push(`Monorepo detected: share config via mergeConfig() from 'vitest/config' instead of preset paths`);
  }

  lines.push(``);
  lines.push(`// Next steps after migration:`);
  tailoredNextSteps.forEach((step, i) => lines.push(`// ${i + 1}. ${step}`));

  if (hadDynamicProps) {
    warnManual(
      'config.dynamic',
      `Dynamic / spread / computed-key properties were preserved as // MANUAL comments. Resolve them before running Vitest.`
    );
  }

  return {
    output: lines.join('\n'),
    warnings,
    flags: {
      monorepo: hasMonorepoSignal,
      embeddedParent,
      needsCoverage,
      needsJsdom,
      needsHappyDom,
      needsTsconfigPaths,
      needsSvgr,
      usesGlobalsTrue,
      setupFiles: detectedSetupFiles,
      targetVitest,
    },
  };

  // ---- Helpers (closures over local state) ----
  function handleModuleNameMapper(obj: t.ObjectExpression) {
    obj.properties.forEach((p) => {
      if (!t.isObjectProperty(p)) return;
      const aliasKey = getPropName(p) ?? '';
      let aliasValueNode = p.value as t.Node;
      if (t.isArrayExpression(aliasValueNode)) {
        const fallbackCount = aliasValueNode.elements.length;
        const first = aliasValueNode.elements[0];
        if (!first) {
          warnManual('resolve.alias', `moduleNameMapper entry '${aliasKey}' has an empty fallback array. Add the equivalent resolve.alias manually.`);
          return;
        }
        if (!t.isStringLiteral(first)) {
          warnManual('resolve.alias', `moduleNameMapper entry '${aliasKey}' uses a non-string fallback array. Add the equivalent resolve.alias manually.`);
          return;
        }
        aliasValueNode = first;
        if (fallbackCount > 1) {
          warnVerify(
            'resolve.alias',
            `moduleNameMapper entry '${aliasKey}' has multiple fallback targets. Vitest resolve.alias only accepts one target, so the first static target was used.`
          );
        }
      }
      const aliasVal = getSourceCode(aliasValueNode);

      if (
        t.isCallExpression(aliasValueNode) &&
        t.isIdentifier(aliasValueNode.callee, { name: 'pathsToModuleNameMapper' })
      ) {
        needsTsconfigPaths = true;
        return;
      }

      // CSS / preprocessor stubs.
      if (/\\\.\(css|less|scss|sass|styl|stylus\)/.test(aliasKey)) {
        warnVerify(
          'resolve.cssStub',
          `CSS stub for ${aliasKey} detected. Set test.css: false in Vitest, or use a Vite plugin if you need CSS modules typed.`
        );
        setScalar(test, 'css', 'false');
        return;
      }

      // Image / static asset stubs.
      const assetMatch = ASSET_EXTS.some((ext) =>
        aliasKey.includes(`\\.(${ext})`) || aliasKey.includes(`|${ext}`) || aliasKey.includes(`\\.${ext}`)
      ) || /\\\.\((?:gif|png|jpg|jpeg|svg|webp|avif|ico)\b/.test(aliasKey);
      if (assetMatch) {
        // Only suggest vite-plugin-svgr when the mapper *target* is an SVG-to-React-component
        // transformer — never from the key alone. A generic stub (fileMock.js,
        // identity-obj-proxy, a plain string path) must not pull in svgr or rewrite import
        // semantics to `?react`, even when the key also matches `.svg`.
        const keyMentionsSvg = /svg/i.test(aliasKey);
        const targetIsSvgrTransformer = /@svgr\b|\bsvgr\b|svg-?transformer/i.test(aliasVal);
        if (keyMentionsSvg && targetIsSvgrTransformer) {
          needsSvgr = true;
          if (!rootImports.some((line) => line.includes(`from 'vite-plugin-svgr'`))) {
            rootImports.push(`import svgr from 'vite-plugin-svgr';`);
          }
          if (!rootPlugins.includes('svgr()')) {
            rootPlugins.push('svgr()');
          }
          warnInfo(
            'resolve.svgr',
            `SVG-to-component transformer (${aliasVal}) detected for ${aliasKey}. Replaced with the vite-plugin-svgr plugin; import SVGs as React components via './foo.svg?react'. The install step is added to the next-steps block.`
          );
        } else {
          warnVerify(
            'resolve.assetStub',
            `Asset stub for ${aliasKey} -> ${aliasVal} detected. Vite serves assets as URLs by default; remove the stub, or add a Vite plugin (e.g. vite-plugin-svgr for SVG-as-component) if you relied on a transformer.`
          );
        }
        return;
      }

      // Font stubs.
      const fontMatch = FONT_EXTS.some((ext) =>
        aliasKey.includes(`\\.(${ext})`) || aliasKey.includes(`|${ext}`) || aliasKey.includes(`\\.${ext}`)
      ) || /\\\.\((?:woff2?|eot|ttf|otf)\b/.test(aliasKey);
      if (fontMatch) {
        warnInfo(
          'resolve.fontStub',
          `Font stub for ${aliasKey} detected. Vite handles font URLs natively. Drop the stub.`
        );
        return;
      }

      // Plain alias (path or package redirect).
      let cleanKey = aliasKey.replace(/^\^/, '').replace(/\$$/, '');
      if (cleanKey.endsWith('/(.*)')) cleanKey = cleanKey.replace(/\/\(\.\*\)$/, '');
      else if (cleanKey.endsWith('(.*)')) cleanKey = cleanKey.replace(/\(\.\*\)$/, '');

      // Keys that still carry regex syntax after the prefix cleanups (mid-string
      // capture groups, alternations) cannot become string aliases. Vite's
      // resolve.alias accepts the array form { find: /regex/, replacement } with
      // $1-style backreferences, so emit that instead of a broken string alias.
      if (/[()[\]{}|?+*\\^$]/.test(cleanKey)) {
        const regexSource = aliasKey.replace(/\//g, '\\/');
        let regexFind: string;
        try {
          // Validate the pattern before emitting it as a literal.
          new RegExp(aliasKey);
          regexFind = `/${regexSource}/`;
        } catch {
          warnManual('resolve.aliasRegex', `moduleNameMapper key '${aliasKey}' is not a valid regular expression. Add the equivalent resolve.alias manually.`);
          return;
        }
        resolveAliasRegex.push({ find: regexFind, replacement: aliasVal });
        warnVerify(
          'resolve.aliasRegex',
          `moduleNameMapper key '${aliasKey}' does not reduce to a string prefix. It was emitted as a regex alias ({ find: ${regexFind}, replacement: ${aliasVal} }); verify the capture-group substitution resolves correctly.`
        );
        return;
      }

      let cleanVal = aliasVal;
      if (cleanVal.endsWith(`/$1'`) || cleanVal.endsWith(`/$1"`)) cleanVal = cleanVal.replace(/\/\$1(['"])$/, '$1');
      else if (cleanVal.endsWith(`$1'`) || cleanVal.endsWith(`$1"`)) cleanVal = cleanVal.replace(/\$1(['"])$/, '$1');

      // Prefer absolute path helpers for relative file aliases.
      const aliasTargetIsRelative = /^['"]\.\.?\//.test(cleanVal);
      let targetExpr = cleanVal;
      if (aliasTargetIsRelative) {
        const stringContent = cleanVal.slice(1, -1);
        targetExpr = `path.resolve(__dirname, ${JSON.stringify(stringContent)})`;
        if (!rootImports.some((line) => line.includes(`from 'node:path'`))) {
          rootImports.unshift(`import path from 'node:path';`);
        }
        warnVerify(
          'resolve.alias',
          `Relative alias '${cleanKey}' was rewritten with path.resolve(__dirname, ...) so Vite resolves it from the config file location.`
        );
      }
      resolveAlias.set(cleanKey, targetExpr);
    });
  }

  function handleGlobalsObject(obj: t.ObjectExpression) {
    obj.properties.forEach((p) => {
      if (!t.isObjectProperty(p)) return;
      const subKey = getPropName(p);
      if (!subKey) return;
      if (subKey === 'ts-jest') {
        warnInfo('globals.define', `globals['ts-jest'] dropped. Vitest handles TypeScript via Vite; no ts-jest config needed.`);
        return;
      }
      define.set(subKey, getSourceCode(p.value as t.Node));
    });
    warnManual(
      'globals.define',
      `Jest 'globals' object values were moved to root-level Vite 'define'. Note that 'globals: true' in Vitest exposes test APIs and is unrelated to injected constants.`
    );
  }

  function handleCoverageThreshold(value: t.Node, source: string) {
    if (!t.isObjectExpression(value)) {
      setScalar(coverage, 'thresholds', source);
      warnManual('coverage.thresholds', `coverageThreshold value ${source} is not a static object. Verify coverage.thresholds manually.`);
      return;
    }

    const thresholdEntries: string[] = [];
    let sawGlobal = false;
    let sawPathThreshold = false;
    let hadDynamic = false;
    let fallbackToOriginal = false;

    value.properties.forEach((p) => {
      if (!t.isObjectProperty(p) || p.computed) {
        hadDynamic = true;
        return;
      }
      const thresholdKey = getPropName(p);
      if (!thresholdKey) {
        hadDynamic = true;
        return;
      }

      if (thresholdKey === 'global') {
        sawGlobal = true;
        if (!t.isObjectExpression(p.value)) {
          fallbackToOriginal = true;
          return;
        }
        p.value.properties.forEach((sub) => {
          if (!t.isObjectProperty(sub) || sub.computed) {
            hadDynamic = true;
            return;
          }
          const subKey = getPropName(sub);
          if (!subKey) {
            hadDynamic = true;
            return;
          }
          thresholdEntries.push(`${quoteKey(subKey)}: ${getCompactSourceCode(sub.value as t.Node)}`);
        });
        return;
      }

      sawPathThreshold = true;
      thresholdEntries.push(`${quoteKey(thresholdKey)}: ${getCompactSourceCode(p.value as t.Node)}`);
    });

    if (fallbackToOriginal || thresholdEntries.length === 0) {
      setScalar(coverage, 'thresholds', source);
      warnManual('coverage.thresholds', `coverageThreshold.global could not be unwrapped. Verify coverage.thresholds manually.`);
      return;
    }

    setScalar(coverage, 'thresholds', `{ ${thresholdEntries.join(', ')} }`);
    coverage.noteFor.set('thresholds', `VERIFY: V8 AST remapping in Vitest 4 may shift previously-passing thresholds — re-baseline${sawPathThreshold ? '; path thresholds: Vitest keeps matching files in global thresholds' : ''}`);

    if (sawGlobal) {
      warnInfo('coverage.thresholds', `coverageThreshold.global was unwrapped into Vitest coverage.thresholds.`);
    }
    if (sawPathThreshold) {
      warnVerify(
        'coverage.thresholds',
        `Jest subtracts path/glob coverageThreshold groups from global thresholds. Vitest keeps matching files in global thresholds, so review mixed global and path thresholds.`
      );
    }
    if (hadDynamic) {
      warnManual('coverage.thresholds', `Some dynamic coverageThreshold entries could not be converted. Review coverage.thresholds manually.`);
    }
  }

  function handleCoverageIncludePatterns(value: t.Node, source: string) {
    if (!t.isArrayExpression(value)) {
      appendArray(coverage, 'include', source);
      warnVerify('coverage.include', `collectCoverageFrom was not a static array. Verify coverage.include manually, especially any negated patterns.`);
      return;
    }

    const includeItems: string[] = [];
    const excludeItems: string[] = [];
    let dynamic = false;

    value.elements.forEach((el) => {
      if (!t.isStringLiteral(el)) {
        if (el) includeItems.push(getSourceCode(el as t.Node));
        dynamic = true;
        return;
      }
      if (el.value.startsWith('!')) {
        excludeItems.push(JSON.stringify(stripRootDir(el.value.slice(1))));
      } else {
        includeItems.push(JSON.stringify(stripRootDir(el.value)));
      }
    });

    if (includeItems.length > 0) {
      coverage.arrays.set('include', [...(coverage.arrays.get('include') ?? []), ...includeItems]);
    }
    if (excludeItems.length > 0) {
      coverage.arrays.set('exclude', [...(coverage.arrays.get('exclude') ?? []), ...excludeItems]);
      warnInfo('coverage.include', `Negated collectCoverageFrom patterns were moved to coverage.exclude.`);
    }
    if (dynamic) {
      warnManual('coverage.include', `Some collectCoverageFrom entries were dynamic. Verify coverage.include and coverage.exclude manually.`);
    }
  }

  function applyTestEnvironment(section: ConfigSection, value: t.Node, source: string) {
    const literal = t.isStringLiteral(value) ? value.value : '';
    if (literal === 'jest-environment-jsdom') {
      setScalar(section, 'environment', `'jsdom'`);
      needsJsdom = true;
      warnInfo('env.environment', `testEnvironment 'jest-environment-jsdom' was normalized to Vitest environment 'jsdom'. Install the 'jsdom' package.`);
    } else if (literal === 'jest-environment-node') {
      setScalar(section, 'environment', `'node'`);
      warnInfo('env.environment', `testEnvironment 'jest-environment-node' was normalized to Vitest environment 'node'.`);
    } else if (literal === '@happy-dom/jest-environment') {
      setScalar(section, 'environment', `'happy-dom'`);
      needsHappyDom = true;
      warnInfo('env.environment', `testEnvironment '@happy-dom/jest-environment' was normalized to Vitest environment 'happy-dom'. Install the 'happy-dom' package.`);
    } else {
      setScalar(section, 'environment', source);
    }
    if (literal === 'jsdom') {
      needsJsdom = true;
      warnInfo('env.environment', `environment 'jsdom' requires installing the 'jsdom' package.`);
    } else if (literal === 'happy-dom') {
      needsHappyDom = true;
      warnInfo('env.environment', `environment 'happy-dom' requires installing the 'happy-dom' package.`);
    } else if (
      literal === 'node' ||
      literal === 'jest-environment-jsdom' ||
      literal === 'jest-environment-node' ||
      literal === '@happy-dom/jest-environment'
    ) {
      // built-in after normalization, no further checks needed
    } else if (literal && (literal.startsWith('.') || literal.endsWith('.js') || literal.endsWith('.ts') || literal.endsWith('.cjs') || literal.endsWith('.mjs'))) {
      warnManual(
        'env.environment',
        `Custom testEnvironment file '${literal}' detected. Vitest's environment interface differs from Jest. Port the environment module manually.`
      );
    } else if (literal) {
      warnVerify(
        'env.environment',
        `Custom testEnvironment '${literal}' detected. Verify it is published as a Vitest-compatible environment package.`
      );
    }
  }

  // Nest Jest's flat testEnvironmentOptions under the environment name, the shape
  // Vitest expects (environmentOptions: { jsdom: { ... } }). Flat keys are ignored
  // by Vitest, so a plain rename would silently do nothing. Must run after the
  // section's 'environment' scalar is settled.
  function applyEnvironmentOptions(section: ConfigSection, value: t.Node, context: string) {
    if (!t.isObjectExpression(value)) {
      section.raw.push(`// MANUAL: testEnvironmentOptions: ${getCompactSourceCode(value)},`);
      warnManual(
        'env.options',
        `${context}testEnvironmentOptions is not a static object and could not be namespaced. Nest the options under the environment name manually (e.g. environmentOptions: { jsdom: { ... } }).`
      );
      return;
    }
    const props: string[] = [];
    let hadCustomExportConditions = false;
    for (const p of value.properties) {
      if (!t.isObjectProperty(p) || p.computed) {
        section.raw.push(`// MANUAL: testEnvironmentOptions entry ${getCompactSourceCode(p)},`);
        warnManual('env.options', `${context}testEnvironmentOptions contains a dynamic entry that could not be converted.`);
        continue;
      }
      const key = getPropName(p);
      if (!key) continue;
      if (key === 'customExportConditions') {
        hadCustomExportConditions = true;
        continue;
      }
      props.push(`${quoteKey(key)}: ${getSourceCode(p.value as t.Node)}`);
    }
    if (hadCustomExportConditions) {
      warnManual(
        'env.options',
        `${context}testEnvironmentOptions.customExportConditions was dropped: Vitest has no equivalent. If it was the MSW workaround, MSW needs no export-condition override under Vitest. Otherwise set resolve.conditions in the Vite config.`
      );
    }
    if (props.length === 0) return;
    const inner = `{ ${props.join(', ')} }`;
    const envValue = section.scalars.get('environment') ?? '';
    const envLiteral = /^['"](.*)['"]$/.exec(envValue.trim())?.[1] ?? '';
    if (envLiteral === 'happy-dom') {
      setScalar(section, 'environmentOptions', `{ happyDOM: ${inner} }`);
      warnVerify(
        'env.options',
        `${context}testEnvironmentOptions was nested under environmentOptions.happyDOM. Verify each option is supported by happy-dom; Jest and happy-dom option names do not always match.`
      );
    } else if (envLiteral === 'jsdom' || envLiteral === '') {
      setScalar(section, 'environmentOptions', `{ jsdom: ${inner} }`);
      if (envLiteral === '') {
        warnVerify(
          'env.options',
          `${context}testEnvironmentOptions was nested under environmentOptions.jsdom, but no testEnvironment was set (Jest defaults to node, which takes no options). Verify the jsdom namespace is the right one.`
        );
      } else {
        warnVerify(
          'env.options',
          `${context}testEnvironmentOptions was nested under environmentOptions.jsdom (Vitest namespaces environment options per environment; flat keys are ignored). Verify each option is a valid jsdom constructor option.`
        );
      }
    } else {
      section.raw.push(`// MANUAL: testEnvironmentOptions: ${getCompactSourceCode(value)},`);
      warnManual(
        'env.options',
        `${context}testEnvironmentOptions targets environment ${envValue || 'unknown'}, which takes no options in Vitest (only jsdom and happy-dom do). Port the options manually if the custom environment reads them.`
      );
    }
  }

  function projectLabel(obj: t.ObjectExpression, index: number): string {
    for (const p of obj.properties) {
      if (!t.isObjectProperty(p) || p.computed || getPropName(p) !== 'displayName') continue;
      if (t.isStringLiteral(p.value)) return `'${p.value.value}'`;
      if (t.isObjectExpression(p.value)) {
        const nameProp = p.value.properties.find(
          (pp): pp is t.ObjectProperty => t.isObjectProperty(pp) && getPropName(pp) === 'name'
        );
        if (nameProp && t.isStringLiteral(nameProp.value)) return `'${nameProp.value.value}'`;
      }
    }
    return `#${index + 1}`;
  }

  // Map one static project object's fields into a per-project ConfigSection.
  // Reuses the same section helpers as the root config so the field semantics match.
  function convertProjectObject(obj: t.ObjectExpression, label: string): string[] {
    const proj = newSection();
    let projEnvOptions: t.Node | null = null;
    obj.properties.forEach((p) => {
      if (t.isSpreadElement(p)) {
        proj.raw.push(`// MANUAL: spread '...${getCompactSourceCode(p.argument)}' could not be statically resolved.`);
        warnManual('projects.field', `projects ${label}: spread entries cannot be statically converted. Inline the values.`);
        return;
      }
      if (!t.isObjectProperty(p) || p.computed) {
        proj.raw.push(`// MANUAL: a dynamic property could not be converted.`);
        warnManual('projects.field', `projects ${label}: a dynamic property could not be statically converted.`);
        return;
      }
      const key = getPropName(p);
      if (!key) return;
      const value = p.value as t.Node;
      const source = getSourceCode(value);
      switch (key) {
        case 'displayName':
          if (t.isObjectExpression(value)) {
            const nameProp = value.properties.find(
              (pp): pp is t.ObjectProperty => t.isObjectProperty(pp) && getPropName(pp) === 'name'
            );
            if (nameProp) setScalar(proj, 'name', getSourceCode(nameProp.value as t.Node));
            warnInfo('projects.field', `projects ${label}: displayName color was dropped; a Vitest project name is a plain string.`);
          } else {
            setScalar(proj, 'name', source);
          }
          break;
        case 'testMatch':
          appendArray(proj, 'include', source);
          break;
        case 'testRegex':
          handleTestRegex(value, proj, `projects ${label}: `);
          break;
        case 'testEnvironment':
          applyTestEnvironment(proj, value, source);
          break;
        case 'testEnvironmentOptions':
          projEnvOptions = value;
          break;
        case 'testPathIgnorePatterns':
          handleRegexIgnorePatterns(value, proj, 'exclude', 'testPathIgnorePatterns');
          break;
        case 'roots':
          if (t.isArrayExpression(value)) {
            if (value.elements.length > 1) {
              warnInfo(
                'discovery.roots',
                `projects ${label}: roots had ${value.elements.length} entries; Vitest test.dir takes a single directory. Kept the first.`
              );
            }
            if (value.elements[0]) setScalar(proj, 'dir', getSourceCode(value.elements[0]));
          } else {
            setScalar(proj, 'dir', source);
          }
          break;
        case 'setupFiles':
        case 'setupFilesAfterEnv':
          collectSetupPaths(value);
          appendArray(proj, 'setupFiles', source);
          if (key === 'setupFilesAfterEnv') {
            warnVerify(
              'setup.order',
              `setupFilesAfterEnv runs after the test framework in Jest; in Vitest setupFiles runs before tests. Move framework-dependent calls (e.g. expect.extend) into a setup that imports vitest first.`
            );
          }
          break;
        case 'testTimeout':
        case 'maxConcurrency':
        case 'silent':
        case 'clearMocks':
        case 'restoreMocks':
        case 'globals':
          setScalar(proj, key, source);
          break;
        default:
          proj.raw.push(`// MANUAL: ${key}: ${getCompactSourceCode(value)},`);
          warnManual('projects.field', `projects ${label}: '${key}' was not converted. Port it into this project's config manually.`);
      }
    });
    if (projEnvOptions) {
      applyEnvironmentOptions(proj, projEnvOptions, `projects ${label}: `);
    }
    return renderSection(proj, '      ', format);
  }

  // Render the captured Jest projects array as Vitest test.projects lines
  // (relative indentation; renderSection prefixes the test-block indent).
  // Vitest 3 used the test.workspace key (renamed to test.projects in 3.2).
  function renderProjectsLines(arr: t.ArrayExpression): string[] {
    const lines: string[] = [targetVitest === 3 ? 'workspace: [' : 'projects: ['];
    arr.elements.forEach((el, i) => {
      if (!el) return;
      if (t.isStringLiteral(el)) {
        lines.push(`  '${normalizeRootDir(el.value)}',`);
        return;
      }
      if (t.isObjectExpression(el)) {
        const inner = convertProjectObject(el, projectLabel(el, i));
        lines.push(`  {`);
        lines.push(`    test: {`);
        inner.forEach((l) => lines.push(l));
        lines.push(`    },`);
        lines.push(`  },`);
        return;
      }
      lines.push(`  // MANUAL: project entry ${getCompactSourceCode(el as t.Node)} could not be statically converted.`);
      warnManual('projects.dynamic', `projects entry #${i + 1} is not a static object or string and was not converted.`);
    });
    lines.push('],');
    return lines;
  }

  // Convert testRegex to equivalent glob(s) where the pattern is simple enough;
  // fall back to the default Vitest glob with a verify warning otherwise.
  // Shared by the root config and project entries (label prefixes the warning).
  function handleTestRegex(value: t.Node, section: ConfigSection, label: string) {
    const patterns: string[] = [];
    let allStatic = true;
    if (t.isStringLiteral(value)) {
      patterns.push(value.value);
    } else if (t.isArrayExpression(value)) {
      value.elements.forEach((el) => {
        if (el && t.isStringLiteral(el)) patterns.push(el.value);
        else allStatic = false;
      });
    } else {
      allStatic = false;
    }

    const globs: string[] = [];
    let allConverted = allStatic && patterns.length > 0;
    for (const pat of patterns) {
      const converted = convertTestRegexToGlobs(pat);
      if (converted) {
        converted.forEach((g) => {
          if (!globs.includes(g)) globs.push(g);
        });
      } else {
        allConverted = false;
      }
    }

    if (allConverted) {
      appendArray(section, 'include', `[${globs.map((g) => JSON.stringify(g)).join(', ')}]`);
      section.noteFor.set('include', `VERIFY: converted from testRegex ${getCompactSourceCode(value)} — verify file matching`);
      warnVerify(
        'discovery.testRegex',
        `${label}testRegex ${getCompactSourceCode(value)} was converted to glob pattern(s): ${globs.join(', ')}. Regexes and globs match differently on edge cases — verify the matched file set.`
      );
      return;
    }

    if (!section.arrays.has('include')) {
      appendArray(section, 'include', `['**/*.{test,spec}.{ts,tsx,js,jsx}']`);
    }
    section.noteFor.set('include', `VERIFY: testRegex ${getCompactSourceCode(value)} was converted to default Vitest glob — verify file matching`);
    section.raw.push(`// NOTE: testRegex was ${getCompactSourceCode(value)}. Verify file matching against the default Vitest glob.`);
    warnVerify(
      'discovery.testRegex',
      `${label}testRegex could not be converted to an equivalent glob; the default Vitest glob was used instead. Verify file matching.`
    );
  }

  // Map known third-party reporters to Vitest built-ins instead of copying a
  // reporter package name that crashes unless it stays installed.
  function handleReporters(value: t.Node, source: string) {
    if (!t.isArrayExpression(value)) {
      warnManual('reporters.dynamic', `reporters value ${source} is not a static array. Re-author for Vitest's reporter API.`);
      return;
    }

    const rendered: string[] = [];
    let copiedVerbatim = false;

    const reporterName = (el: t.Node): string | null => {
      if (t.isStringLiteral(el)) return el.value;
      if (t.isArrayExpression(el) && el.elements[0] && t.isStringLiteral(el.elements[0])) {
        return el.elements[0].value;
      }
      return null;
    };

    value.elements.forEach((el) => {
      if (!el) return;
      const node = el as t.Node;
      const name = reporterName(node);

      if (name === 'jest-junit') {
        const options = t.isArrayExpression(node) && node.elements[1] && t.isObjectExpression(node.elements[1])
          ? node.elements[1]
          : null;
        let outputFile: string | null = null;
        let dir: string | null = null;
        let fileName: string | null = null;
        let droppedKeys: string[] = [];
        let dynamicOptions = false;
        if (options) {
          for (const p of options.properties) {
            if (!t.isObjectProperty(p) || p.computed) {
              dynamicOptions = true;
              continue;
            }
            const optKey = getPropName(p);
            const optVal = t.isStringLiteral(p.value) ? p.value.value : null;
            if (optKey === 'outputFile') {
              if (optVal != null) outputFile = optVal;
              else dynamicOptions = true;
            } else if (optKey === 'outputDirectory') {
              if (optVal != null) dir = optVal;
              else dynamicOptions = true;
            } else if (optKey === 'outputName') {
              if (optVal != null) fileName = optVal;
              else dynamicOptions = true;
            } else if (optKey) {
              droppedKeys.push(optKey);
            }
          }
        }
        if (dynamicOptions) {
          rendered.push(getSourceCode(node));
          copiedVerbatim = true;
          warnVerify('reporters.verbatim', `jest-junit options could not be read statically and were copied verbatim. Map them to Vitest's ['junit', { outputFile }] manually.`);
          return;
        }
        const resolvedFile =
          outputFile ?? (dir != null || fileName != null ? `${normalizeRootDir(dir ?? '.')}/${fileName ?? 'junit.xml'}`.replace(/^\.\//, '') : 'junit.xml');
        rendered.push(`['junit', { outputFile: ${JSON.stringify(resolvedFile)} }]`);
        warnInfo('reporters.mapped', `jest-junit was mapped to Vitest's built-in junit reporter (outputFile: ${resolvedFile}). Uninstall jest-junit.`);
        if (droppedKeys.length > 0) {
          warnVerify('reporters.mapped', `jest-junit option(s) ${droppedKeys.join(', ')} have no Vitest junit equivalent and were dropped. Check Vitest's junit reporter options if you relied on them.`);
        }
        return;
      }

      if (name === 'github-actions') {
        rendered.push(`'github-actions'`);
        warnInfo('reporters.mapped', `The github-actions reporter was mapped to Vitest's built-in 'github-actions' reporter (options, if any, were dropped).`);
        return;
      }

      rendered.push(getSourceCode(node));
      if (name == null || !VITEST_BUILTIN_REPORTERS.has(name)) copiedVerbatim = true;
    });

    appendArray(test, 'reporters', `[${rendered.join(', ')}]`);
    if (copiedVerbatim) {
      test.noteFor.set('reporters', `VERIFY: Jest and Vitest built-in reporter names differ (default/verbose/dot/json/junit/tap/html)`);
      warnVerify(
        'reporters.verbatim',
        `Some reporters were copied verbatim. Jest and Vitest built-in reporter names differ (e.g. 'default', 'verbose', 'dot', 'json', 'junit', 'tap', 'html').`
      );
    }
  }

  // Emit Vite's server.watch.ignored for static patterns; fall back to the
  // manual warning for regex/dynamic inputs.
  function handleWatchPathIgnorePatterns(value: t.Node, source: string) {
    if (!t.isArrayExpression(value)) {
      warnManual(
        'watch.ignored',
        `watchPathIgnorePatterns is not a static array. Use Vite's server.watch.ignored in the emitted config manually.`
      );
      return;
    }
    let fellBack = false;
    value.elements.forEach((el) => {
      if (el && t.isStringLiteral(el)) {
        const glob = convertSimpleIgnorePatternToGlob(el.value);
        if (glob) {
          const anchored = glob.startsWith('**') ? glob : `**/${glob}`;
          if (!rootServerWatchIgnored.includes(anchored)) rootServerWatchIgnored.push(anchored);
          return;
        }
      }
      fellBack = true;
    });
    if (rootServerWatchIgnored.length > 0) {
      warnInfo('watch.ignored', `watchPathIgnorePatterns was mapped to Vite's server.watch.ignored in the emitted config.`);
    }
    if (fellBack) {
      warnManual(
        'watch.ignored',
        `Some watchPathIgnorePatterns entries (${source}) are regexes or dynamic values that do not translate to globs. Add them to server.watch.ignored manually.`
      );
    }
  }

  function handleRegexIgnorePatterns(
    value: t.Node,
    section: ConfigSection,
    targetKey: string,
    sourceKey: string
  ) {
    if (!t.isArrayExpression(value)) {
      section.raw.push(`// MANUAL: ${sourceKey}: ${getSourceCode(value)},`);
      warnManual('discovery.exclude', `${sourceKey} is not a static array. Convert regex path ignores to Vitest glob excludes manually.`);
      return;
    }

    const converted: string[] = [];
    value.elements.forEach((el) => {
      if (!t.isStringLiteral(el)) {
        if (el) section.raw.push(`// MANUAL: ${sourceKey} entry ${getSourceCode(el as t.Node)}`);
        warnManual('discovery.exclude', `${sourceKey} contains a dynamic entry. Convert it to a Vitest glob manually.`);
        return;
      }

      const glob = convertSimpleIgnorePatternToGlob(el.value);
      if (glob) {
        converted.push(JSON.stringify(glob));
      } else {
        section.raw.push(`// MANUAL: ${sourceKey} regex ${JSON.stringify(el.value)} was not copied to ${targetKey}.`);
        warnVerify(
          'discovery.exclude',
          `${sourceKey} regex pattern ${JSON.stringify(el.value)} was not copied because Vitest ${targetKey} expects glob patterns. Convert it manually.`
        );
      }
    });

    if (converted.length > 0) {
      section.arrays.set(targetKey, [...(section.arrays.get(targetKey) ?? []), ...converted]);
    }
  }

  function handleTransform(value: t.Node) {
    if (!t.isObjectExpression(value)) {
      warnInfo('transform.custom', `transform value ${getSourceCode(value)} could not be inspected. Vite handles most transforms natively.`);
      return;
    }
    let dropped = 0;
    value.properties.forEach((p) => {
      if (!t.isObjectProperty(p)) return;
      const matcher = getPropName(p) ?? '';
      const targetNode = p.value;
      const targetSrc = t.isStringLiteral(targetNode)
        ? targetNode.value
        : Array.isArray((targetNode as t.ArrayExpression).elements)
        ? getSourceCode(targetNode as t.Node)
        : getSourceCode(targetNode as t.Node);

      // ts-jest / babel-jest / @swc/jest are all "compile TS/JS for Jest":
      // Vite's own transform pipeline replaces them with nothing to configure.
      if (
        typeof targetSrc === 'string' &&
        (targetSrc.includes('ts-jest') || targetSrc.includes('babel-jest') || targetSrc.includes('@swc/jest'))
      ) {
        dropped++;
        return;
      }
      // Framework single-file-component transforms map to concrete Vite plugins.
      if (typeof targetSrc === 'string' && /@vue\/vue3-jest|vue3-jest|\bvue-jest\b/.test(targetSrc)) {
        warnVerify(
          'transform.framework',
          `transform entry '${matcher}' uses ${targetSrc}. Vite compiles .vue files via @vitejs/plugin-vue — add it to the plugins array (npm i -D @vitejs/plugin-vue) and drop the transform.`
        );
        return;
      }
      if (typeof targetSrc === 'string' && targetSrc.includes('svelte-jester')) {
        warnVerify(
          'transform.framework',
          `transform entry '${matcher}' uses ${targetSrc}. Vite compiles .svelte files via @sveltejs/vite-plugin-svelte — add it to the plugins array (npm i -D @sveltejs/vite-plugin-svelte) and drop the transform.`
        );
        return;
      }
      // File-stub transforms (e.g. jest-transform-stub, jest-svg-transformer) usually become Vite plugins or are unnecessary.
      if (typeof targetSrc === 'string' && /transform-stub|svg-transformer|file-transformer/.test(targetSrc)) {
        warnVerify(
          'transform.fileStub',
          `transform entry '${matcher}' uses a file-stub transformer (${targetSrc}). Replace with the appropriate Vite plugin or rely on Vite's asset handling.`
        );
        return;
      }
      warnManual(
        'transform.custom',
        `transform entry '${matcher}' -> ${typeof targetSrc === 'string' ? targetSrc : 'custom transformer'} has no direct equivalent. Replace with a Vite plugin or migrate the transformer.`
      );
    });
    if (dropped > 0) {
      warnInfo('transform.dropped', `Dropped ${dropped} ts-jest/babel-jest/@swc/jest transform entr${dropped === 1 ? 'y' : 'ies'}. Vite handles them natively.`);
    }
  }
}

function emptyFlags(targetVitest: TargetVitest = 4): ConversionFlags {
  return {
    monorepo: false,
    embeddedParent: null,
    needsCoverage: false,
    needsJsdom: false,
    needsHappyDom: false,
    needsTsconfigPaths: false,
    needsSvgr: false,
    usesGlobalsTrue: false,
    setupFiles: [],
    targetVitest,
  };
}

// Reporter names that are valid Vitest built-ins as-is (no verbatim warning).
const VITEST_BUILTIN_REPORTERS = new Set([
  'default',
  'verbose',
  'dot',
  'json',
  'junit',
  'tap',
  'tap-flat',
  'html',
  'hanging-process',
  'github-actions',
]);

function quoteKey(key: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) return key;
  if (!key.includes("'") && !/[\\\n\r\t]/.test(key)) return `'${key}'`;
  return JSON.stringify(key);
}

// Quote an alias key for the array-form `{ find: ... }` position (always a
// string literal there, unlike object keys which may stay bare).
function quoteAliasFind(key: string): string {
  if (!key.includes("'") && !/[\\\n\r\t]/.test(key)) return `'${key}'`;
  return JSON.stringify(key);
}

/**
 * Path-aware `<rootDir>` normalizer for a single string value. Each occurrence
 * is substituted based on its position rather than a blanket replace:
 *   '<rootDir>'           -> '.'        (the root directory itself)
 *   '<rootDir>/src/x'     -> './src/x'  (leading path anchor)
 *   '^<rootDir>/src'      -> '^src'     (after a regex anchor: collapse)
 *   'foo/<rootDir>/bar'   -> 'foo/bar'  (mid-string after a separator: collapse)
 *   'foo<rootDir>/bar'    -> 'foo/bar'  (mid-string: keep one separator)
 * Strings without the token (package names, plain globs/paths) are untouched.
 */
export function normalizeRootDir(value: string): string {
  if (!value.includes('<rootDir>')) return value;
  let out = '';
  let i = 0;
  while (i < value.length) {
    const idx = value.indexOf('<rootDir>', i);
    if (idx === -1) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, idx);
    let next = idx + '<rootDir>'.length;
    const hasSlash = value[next] === '/';
    if (hasSlash) next++;
    const prev = out[out.length - 1];
    if (out === '') {
      out += next >= value.length && !hasSlash ? '.' : './';
    } else if (prev === '/' || prev === '^' || prev === '(' || prev === '|') {
      // After a separator or regex anchor: the token collapses entirely.
    } else if (hasSlash) {
      out += '/';
    }
    i = next;
  }
  return out;
}

/**
 * `<rootDir>` normalizer for generated source code. The token only ever
 * appears inside string contents, so the position-aware rules above are
 * applied with the preceding quote character treated as string start.
 */
export function normalizeRootDirInCode(code: string): string {
  if (!code.includes('<rootDir>')) return code;
  return code.replace(/<rootDir>(\/)?/g, (match, slash: string | undefined, offset: number) => {
    const prev = offset > 0 ? code[offset - 1] : '';
    const next = code[offset + match.length] ?? '';
    if (prev === `'` || prev === '"' || prev === '`') {
      // String start.
      if (!slash && next === prev) return '.'; // '<rootDir>' alone
      return './';
    }
    if (prev === '/' || prev === '^' || prev === '(' || prev === '|') return '';
    return slash ? '/' : '';
  });
}

/**
 * Translate a Jest testRegex into equivalent Vitest include glob(s), or null
 * when the pattern uses regex features without a faithful glob translation.
 *
 * Covers: simple suffix matchers (`\.test\.tsx?$`), `__tests__/` directory
 * matchers, extension alternates (`[jt]sx?`, `(js|jsx|ts|tsx)`), and the
 * classic Jest/CRA default `(/__tests__/.*|(\.|/)(test|spec))\.[jt]sx?$`.
 */
export function convertTestRegexToGlobs(pattern: string): string[] | null {
  let p = pattern.replace(/<rootDir>\/?/g, '');
  const anchoredStart = p.startsWith('^');
  const anchoredEnd = p.endsWith('$') && !p.endsWith('\\$');
  p = p.replace(/^\^/, '').replace(/\$$/, '');
  if (!p) return null;

  // Idiomatic extension classes → brace placeholders (⟨⟩ avoids re-processing
  // and survives the alternation expansion below).
  p = p
    .replace(/\[jt\]sx\?/g, '⟨js,jsx,ts,tsx⟩')
    .replace(/\[tj\]sx\?/g, '⟨js,jsx,ts,tsx⟩')
    .replace(/\((?:\?:)?js\|jsx\|ts\|tsx\)/g, '⟨js,jsx,ts,tsx⟩')
    .replace(/\((?:\?:)?jsx\?\|tsx\?\)/g, '⟨js,jsx,ts,tsx⟩')
    .replace(/\[jt\]s/g, '⟨js,ts⟩')
    .replace(/\[tj\]s/g, '⟨js,ts⟩')
    .replace(/jsx\?/g, '⟨js,jsx⟩')
    .replace(/tsx\?/g, '⟨ts,tsx⟩')
    .replace(/mjsx\?/g, '⟨mjs,mjsx⟩');

  // Expand (a|b) / (?:a|b) groups and top-level alternation into separate
  // pattern strings, capped to keep pathological inputs out.
  const expanded = expandRegexAlternation(p, 12);
  if (!expanded) return null;

  const globs: string[] = [];
  for (const alt of expanded) {
    let g = alt;
    // `/.*` spans directories; a bare `.*` stays within one path segment.
    g = g.replace(/\/\.\*/g, '/**/*').replace(/\.\*/g, '*');
    // Unescape the two path characters Jest patterns escape.
    g = g.replace(/\\\./g, '.').replace(/\\\//g, '/');
    // Anything still carrying regex syntax has no faithful glob translation.
    if (/[\\^$()[\]{}+?|]/.test(g)) return null;

    if (anchoredStart) {
      g = g.replace(/^\//, '');
    } else if (g.startsWith('/')) {
      g = `**${g}`;
    } else if (g.startsWith('.')) {
      g = `**/*${g}`;
    } else if (!g.startsWith('**')) {
      g = `**/${g}`;
    }
    if (!anchoredEnd && !g.endsWith('*')) g = `${g}*`;
    g = g.replace(/⟨/g, '{').replace(/⟩/g, '}');
    if (!globs.includes(g)) globs.push(g);
  }
  return globs.length > 0 ? globs : null;
}

// Expand the first (…|…) group recursively; null when unbalanced or too many
// alternatives. Nested groups are handled by recursion on each expansion.
function expandRegexAlternation(pattern: string, cap: number): string[] | null {
  // Top-level alternation outside any group.
  const topLevel = splitTopLevel(pattern);
  if (topLevel == null) return null;
  if (topLevel.length > 1) {
    const out: string[] = [];
    for (const part of topLevel) {
      const sub = expandRegexAlternation(part, cap);
      if (!sub) return null;
      out.push(...sub);
      if (out.length > cap) return null;
    }
    return out;
  }

  const start = findUnescaped(pattern, '(');
  if (start === -1) return [pattern];
  let depth = 0;
  let end = -1;
  for (let i = start; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;
  // Quantified groups ((...)?, (...)*) are out of scope.
  const after = pattern[end + 1];
  if (after === '?' || after === '*' || after === '+') return null;

  let body = pattern.slice(start + 1, end);
  if (body.startsWith('?:')) body = body.slice(2);
  else if (body.startsWith('?')) return null; // lookarounds etc.
  const branches = splitTopLevel(body);
  if (branches == null) return null;

  const prefix = pattern.slice(0, start);
  const suffix = pattern.slice(end + 1);
  const out: string[] = [];
  for (const branch of branches) {
    const sub = expandRegexAlternation(`${prefix}${branch}${suffix}`, cap);
    if (!sub) return null;
    out.push(...sub);
    if (out.length > cap) return null;
  }
  return out;
}

// Split on top-level '|' (outside parens). Null when parens are unbalanced.
function splitTopLevel(pattern: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      buf += ch + (pattern[i + 1] ?? '');
      i++;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth < 0) return null;
    if (ch === '|' && depth === 0) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (depth !== 0) return null;
  parts.push(buf);
  return parts;
}

function findUnescaped(pattern: string, ch: string): number {
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '\\') {
      i++;
      continue;
    }
    if (pattern[i] === ch) return i;
  }
  return -1;
}

function unpackArrayLiteral(source: string): string[] {
  const trimmed = source.trim();
  if (!(trimmed.startsWith('[') && trimmed.endsWith(']'))) return [trimmed];
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  const parts: string[] = [];
  let depth = 0;
  let buf = '';
  let inString: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    const prev = inner[i - 1];
    if (inString) {
      buf += ch;
      if (ch === inString && prev !== '\\') inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      buf += ch;
      continue;
    }
    if (ch === '[' || ch === '(' || ch === '{') depth++;
    else if (ch === ']' || ch === ')' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      const item = buf.trim();
      if (item) parts.push(item);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const last = buf.trim();
  if (last) parts.push(last);
  return parts;
}

function renderSection(section: ConfigSection, indent: string, format: boolean): string[] {
  const lines: string[] = [];
  const emit = (full: string) => {
    full.split('\n').forEach((line) => lines.push(line));
  };
  section.scalars.forEach((value, key) => {
    const formatted = format ? prettyFormat(value, indent) : value;
    const note = section.noteFor.get(key);
    const trailing = note ? ` // ${note}` : '';
    emit(`${indent}${quoteKey(key)}: ${formatted},${trailing}`);
  });
  section.arrays.forEach((items, key) => {
    if (items.length === 0) return;
    const note = section.noteFor.get(key);
    const trailing = note ? ` // ${note}` : '';
    const childIndent = indent + '  ';
    const formattedItems = format ? items.map((it) => prettyFormat(it, childIndent)) : items;
    const inline = `[${formattedItems.join(', ')}]`;
    const needsMultiLine =
      format &&
      (inline.length > 70 ||
        items.length > 4 ||
        formattedItems.some((it) => it.includes('\n')));
    if (needsMultiLine) {
      lines.push(`${indent}${quoteKey(key)}: [`);
      formattedItems.forEach((it) => emit(`${childIndent}${it},`));
      lines.push(`${indent}],${trailing}`);
    } else {
      emit(`${indent}${quoteKey(key)}: ${inline},${trailing}`);
    }
  });
  section.raw.forEach((rawLine) => emit(`${indent}${rawLine}`));
  return lines;
}

function prettyFormat(code: string, currentIndent: string): string {
  if (!code) return code;
  // Skip values that are obviously bare literals/identifiers — no need to reparse.
  if (/^(?:true|false|null|undefined|-?\d+(?:\.\d+)?|[A-Za-z_$][A-Za-z0-9_$]*)$/.test(code)) return code;
  let expr: t.Expression;
  try {
    const ast = parser.parse(`(${code})`, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });
    const stmt = ast.program.body[0];
    if (!t.isExpressionStatement(stmt)) return code;
    expr = stmt.expression;
  } catch {
    return code;
  }
  return formatAstNode(expr, currentIndent);
}

function formatAstNode(node: t.Node, currentIndent: string): string {
  const childIndent = currentIndent + '  ';
  if (t.isArrayExpression(node)) {
    if (node.elements.length === 0) return '[]';
    const items = node.elements
      .filter((e): e is t.Expression | t.SpreadElement => e != null)
      .map((e) => formatAstNode(e, childIndent));
    const inline = `[${items.join(', ')}]`;
    if (inline.length <= 70 && !inline.includes('\n')) return inline;
    return `[\n${items.map((s) => `${childIndent}${s}`).join(',\n')},\n${currentIndent}]`;
  }
  if (t.isObjectExpression(node)) {
    const entries: string[] = [];
    for (const p of node.properties) {
      if (t.isSpreadElement(p)) {
        entries.push(`...${formatAstNode(p.argument, childIndent)}`);
        continue;
      }
      if (t.isObjectMethod(p)) {
        entries.push(generate(p, { compact: false }).code);
        continue;
      }
      if (!t.isObjectProperty(p)) continue;
      const keyName =
        t.isIdentifier(p.key)
          ? p.key.name
          : t.isStringLiteral(p.key)
          ? p.key.value
          : t.isNumericLiteral(p.key)
          ? String(p.key.value)
          : generate(p.key).code;
      const formattedKey = p.computed ? `[${generate(p.key).code}]` : quoteKey(keyName);
      const formattedValue = formatAstNode(p.value as t.Node, childIndent);
      entries.push(`${formattedKey}: ${formattedValue}`);
    }
    if (entries.length === 0) return '{}';
    const inline = `{ ${entries.join(', ')} }`;
    if (inline.length <= 70 && !inline.includes('\n')) return inline;
    return `{\n${entries.map((e) => `${childIndent}${e}`).join(',\n')},\n${currentIndent}}`;
  }
  if (t.isStringLiteral(node)) {
    const stripped = normalizeRootDir(node.value);
    if (!stripped.includes("'") && !/[\\\n\r\t]/.test(stripped)) {
      return `'${stripped}'`;
    }
    return JSON.stringify(stripped);
  }
  if (t.isNumericLiteral(node)) return String(node.value);
  if (t.isBooleanLiteral(node)) return String(node.value);
  if (t.isNullLiteral(node)) return 'null';
  if (t.isIdentifier(node)) return node.name;
  if (t.isCallExpression(node)) {
    const callee = formatAstNode(node.callee, currentIndent);
    const argStrs = node.arguments.map((a) => formatAstNode(a as t.Node, childIndent));
    const inline = `${callee}(${argStrs.join(', ')})`;
    if (inline.length <= 70 && !inline.includes('\n')) return inline;
    return `${callee}(\n${argStrs.map((a) => `${childIndent}${a}`).join(',\n')},\n${currentIndent})`;
  }
  if (t.isMemberExpression(node)) {
    const obj = formatAstNode(node.object, currentIndent);
    if (node.computed) {
      const prop = formatAstNode(node.property as t.Node, currentIndent);
      return `${obj}[${prop}]`;
    }
    const prop = t.isIdentifier(node.property)
      ? node.property.name
      : formatAstNode(node.property as t.Node, currentIndent);
    return `${obj}.${prop}`;
  }
  if (t.isTemplateLiteral(node)) {
    return generate(node, { jsescOption: { quotes: 'single' } }).code;
  }
  return normalizeRootDirInCode(generate(node, { compact: false, jsescOption: { quotes: 'single' } }).code)
    .replace(/\n\s*/g, ' ')
    .trim();
}

// Extract package names from common Jest transformIgnorePatterns regex shapes:
//   'node_modules/(?!(swiper|nanoid)/)'   -> ['swiper', 'nanoid']
//   'node_modules/(?!swiper)/'            -> ['swiper']
//   'node_modules/(?!(@scope/pkg|other))' -> ['@scope/pkg', 'other']
function extractPackagesFromIgnorePattern(pattern: string): string[] {
  // Collect the body of every negative lookahead. Most patterns carry one
  // ((?!pkg1|pkg2)), but pnpm-style inputs chain them: (?!.pnpm)(?!(pkg1|pkg2)).
  const bodies: string[] = [];
  const negLookahead = /\(\?!((?:[^()]|\([^()]*\))*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = negLookahead.exec(pattern)) !== null) bodies.push(m[1]);

  const packages: string[] = [];
  for (const rawBody of bodies) {
    // Unwrap one wrapping group, capturing or non-capturing, with an optional
    // path tail: (pkg1|pkg2), (?:pkg1|pkg2)/, (?:pkg1|pkg2)/.* and escaped variants.
    const wrapped = /^\((?:\?:)?(.*?)\)(?:\\?\/(?:\.\*)?)?$/.exec(rawBody);
    const body = wrapped ? wrapped[1] : rawBody;
    for (const rawItem of body.split('|')) {
      const item = rawItem
        .trim()
        .replace(/\\([./])/g, '$1')
        .replace(/\/\.\*$/, '')
        .replace(/\.\*$/, '')
        .replace(/\/$/, '');
      // .pnpm is a directory artifact of the pnpm layout, not a package name.
      if (!item || item === '.pnpm') continue;
      // Items that still carry regex syntax cannot be turned into package names;
      // skipping them lets the caller's could-not-parse warning fire when nothing survives.
      if (/[()?*+^$[\]{}\\]/.test(item)) continue;
      if (!packages.includes(item)) packages.push(item);
    }
  }
  return packages;
}

function convertSimpleIgnorePatternToGlob(pattern: string): string | null {
  const normalized = pattern.replace(/<rootDir>\/?/g, '').replace(/^\.\//, '');
  if (!normalized) return null;
  if (/[\\^$()+?|[\]{}]/.test(normalized)) return null;
  if (normalized.includes('*')) return normalized;
  if (normalized.endsWith('/')) return `${normalized}**`;
  return normalized;
}
