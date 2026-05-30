import * as parser from '@babel/parser';
import _traverse, { type NodePath } from '@babel/traverse';
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

export interface Warning {
  type: 'manual' | 'verify' | 'info';
  message: string;
}

export type OutputMode = 'standalone' | 'merge';

export interface ConvertOptions {
  mode?: OutputMode;
  format?: boolean;
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
}

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
  const warnings: Warning[] = [];
  const seenWarnings = new Set<string>();

  const pushWarning = (type: Warning['type'], message: string) => {
    const key = `${type}::${message}`;
    if (seenWarnings.has(key)) return;
    seenWarnings.add(key);
    warnings.push({ type, message });
  };
  const warnInfo = (msg: string) => pushWarning('info', msg);
  const warnVerify = (msg: string) => pushWarning('verify', msg);
  const warnManual = (msg: string) => pushWarning('manual', msg);

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
        { type: 'manual', message: 'Failed to parse input. Ensure it is valid JavaScript or TypeScript.' },
      ],
      flags: emptyFlags(),
    };
  }

  let configObject: t.ObjectExpression | null = null;
  let embeddedParent: 'vue.config' | 'craco.config' | null = null;
  let usedFunctionForm = false;

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

  // Unwrap function-form configs: () => ({...}), async () => ({...}), function() { return {...} }.
  const extractFromFunctionBody = (node: t.Node): t.ObjectExpression | null => {
    if (!t.isArrowFunctionExpression(node) && !t.isFunctionExpression(node)) return null;
    usedFunctionForm = true;
    const body = node.body;
    if (t.isObjectExpression(body)) return body;
    if (t.isBlockStatement(body)) {
      // Find a single ReturnStatement.
      const returns = body.body.filter((s) => t.isReturnStatement(s)) as t.ReturnStatement[];
      if (returns.length === 1 && returns[0].argument) {
        const direct = extractObjectArg(returns[0].argument);
        if (direct) return direct;
      }
    }
    return null;
  };

  const extractObjectArg = (node: t.Node | null | undefined): t.ObjectExpression | null => {
    if (!node) return null;
    if (t.isObjectExpression(node)) {
      const embedded = tryExtractEmbeddedJest(node);
      return embedded ?? node;
    }
    if (t.isCallExpression(node)) {
      const arg = node.arguments[0];
      if (arg && t.isObjectExpression(arg)) {
        const embedded = tryExtractEmbeddedJest(arg);
        return embedded ?? arg;
      }
    }
    if (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node)) {
      return extractObjectArg(node.expression);
    }
    if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) {
      return extractFromFunctionBody(node);
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
        const direct = extractObjectArg(node.right);
        if (direct) configObject = direct;
        else if (t.isIdentifier(node.right)) {
          // module.exports = configIdentifier — try to resolve to a const declaration.
          const binding = path.scope.getBinding(node.right.name);
          if (binding && t.isVariableDeclarator(binding.path.node)) {
            const init = binding.path.node.init;
            const fromInit = extractObjectArg(init);
            if (fromInit) configObject = fromInit;
          }
        }
      }
    },
    ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
      if (configObject) return;
      const decl = path.node.declaration;
      const direct = extractObjectArg(decl);
      if (direct) configObject = direct;
      else if (t.isIdentifier(decl)) {
        const binding = path.scope.getBinding(decl.name);
        if (binding && t.isVariableDeclarator(binding.path.node)) {
          const fromInit = extractObjectArg(binding.path.node.init);
          if (fromInit) configObject = fromInit;
        }
      }
    },
  });

  if (!configObject) {
    return {
      output:
        `// Could not find a recognizable config object.\n` +
        `// Expected module.exports = {...}, export default {...}, a config identifier,\n` +
        `// a function returning a static object literal, or a parent config object with a 'jest' property.\n\n${input}`,
      warnings: [
        { type: 'manual', message: 'Could not detect Jest configuration object in the provided code.' },
      ],
      flags: emptyFlags(),
    };
  }

  // Surface the input shape to the user so they understand what was extracted.
  if (usedFunctionForm) {
    pushWarning(
      'verify',
      `Detected a function-form config (e.g. module.exports = () => ({...})). The returned static object literal was extracted; any logic in the function body was dropped. Inline the values or call mergeConfig() if dynamic logic is needed.`
    );
  }
  if (embeddedParent === 'vue.config') {
    pushWarning(
      'verify',
      `Detected an embedded 'jest' block inside a vue.config-style file. Only the 'jest' object was migrated. Move the rest of vue.config.js to its own file (it does not belong in vitest.config.ts).`
    );
  } else if (embeddedParent === 'craco.config') {
    pushWarning(
      'verify',
      `Detected an embedded 'jest' block inside a craco.config-style file. Only the 'jest' object was migrated. CRACO's webpack/babel sections need separate Vite-equivalent migration.`
    );
  }

  // Output sections.
  const test = newSection();
  const coverage = newSection();
  const sequenceEntries = new Map<string, string>();
  const resolveAlias = new Map<string, string>(); // key (alias from) -> value (target)
  const resolveExtensions: string[] = [];
  const serverDepsInline: string[] = [];
  const define = new Map<string, string>();
  const rootPlugins: string[] = [];
  const rootImports: string[] = [];
  const tailoredNextSteps: string[] = [];

  // Detection flags for tailored next steps.
  let needsTsconfigPaths = false;
  let needsCoverage = false;
  let selectedCoverageProvider: 'v8' | 'istanbul' | 'custom' | null = null;
  let needsJsdom = false;
  let needsHappyDom = false;
  let needsSvgr = false;
  let usesGlobalsTrue = false;
  let hasMonorepoSignal = false;

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

  const stripRootDir = (code: string) => code.replace(/<rootDir>\/?/g, './');
  const getSourceCode = (node: t.Node) => stripRootDir(generate(node).code);
  const getCompactSourceCode = (node: t.Node) => stripRootDir(generate(node, { compact: true }).code);

  const getPropName = (node: t.ObjectProperty): string | null => {
    if (t.isIdentifier(node.key)) return node.key.name;
    if (t.isStringLiteral(node.key)) return node.key.value;
    if (t.isNumericLiteral(node.key)) return String(node.key.value);
    return null;
  };

  const setScalar = (section: ConfigSection, key: string, value: string) => {
    if (section.scalars.has(key)) {
      warnVerify(
        `Multiple Jest fields map to '${key}'. Kept the latest value; review the input for conflicting settings.`
      );
    }
    section.scalars.set(key, value);
  };

  const setSequence = (key: string, value: string) => {
    if (sequenceEntries.has(key)) {
      warnVerify(
        `Multiple Jest fields map to sequence.${key}. Kept the latest value; review the input for conflicting settings.`
      );
    }
    sequenceEntries.set(key, value);
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
        `Spread '...${exprSrc}' was preserved as a // MANUAL comment. Vitest cannot reproduce dynamic spreads. Inline the values or call mergeConfig() from 'vitest/config'.`
      );
      return;
    }
    if (t.isObjectMethod(prop)) {
      hadDynamicProps = true;
      const name = t.isIdentifier(prop.key) ? prop.key.name : 'method';
      test.raw.push(`// MANUAL: object method '${name}' could not be converted to a static Vitest value.`);
      warnManual(
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
        if (!test.arrays.has('include')) {
          appendArray(test, 'include', `['**/*.{test,spec}.{ts,tsx,js,jsx}']`);
        }
        test.noteFor.set('include', `VERIFY: testRegex ${source} was converted to default Vitest glob — verify file matching`);
        test.raw.push(`// NOTE: testRegex was ${source}. Verify file matching against the default Vitest glob.`);
        warnVerify(`testRegex was converted to the default Vitest glob. Verify file matching.`);
        break;
      case 'testPathIgnorePatterns':
        handleRegexIgnorePatterns(value, test, 'exclude', 'testPathIgnorePatterns');
        break;
      case 'roots':
        if (t.isArrayExpression(value)) {
          if (value.elements.length > 1) {
            warnInfo(
              `roots had ${value.elements.length} entries; Vitest test.dir takes a single directory. Kept the first. Use test.include for multi-root patterns.`
            );
          }
          if (value.elements[0]) setScalar(test, 'dir', getSourceCode(value.elements[0]));
        } else {
          setScalar(test, 'dir', source);
        }
        break;
      case 'testEnvironment': {
        const literal = t.isStringLiteral(value) ? value.value : '';
        if (literal === 'jest-environment-jsdom') {
          setScalar(test, 'environment', `'jsdom'`);
          needsJsdom = true;
          warnInfo(`testEnvironment 'jest-environment-jsdom' was normalized to Vitest environment 'jsdom'. Install the 'jsdom' package.`);
        } else if (literal === 'jest-environment-node') {
          setScalar(test, 'environment', `'node'`);
          warnInfo(`testEnvironment 'jest-environment-node' was normalized to Vitest environment 'node'.`);
        } else {
          setScalar(test, 'environment', source);
        }
        if (literal === 'jsdom') {
          needsJsdom = true;
          warnInfo(`environment 'jsdom' requires installing the 'jsdom' package.`);
        } else if (literal === 'happy-dom') {
          needsHappyDom = true;
          warnInfo(`environment 'happy-dom' requires installing the 'happy-dom' package.`);
        } else if (literal === 'node') {
          // built-in, no install needed
        } else if (literal && (literal.startsWith('.') || literal.endsWith('.js') || literal.endsWith('.ts') || literal.endsWith('.cjs') || literal.endsWith('.mjs'))) {
          warnManual(
            `Custom testEnvironment file '${literal}' detected. Vitest's environment interface differs from Jest. Port the environment module manually.`
          );
        } else if (literal) {
          warnVerify(
            `Custom testEnvironment '${literal}' detected. Verify it is published as a Vitest-compatible environment package.`
          );
        }
        break;
      }
      case 'testEnvironmentOptions':
        setScalar(test, 'environmentOptions', source);
        break;
      case 'testURL': {
        const urlSrc = source;
        setScalar(test, 'environmentOptions', `{ jsdom: { url: ${urlSrc} } }`);
        test.noteFor.set('environmentOptions', `VERIFY: from testURL — merge manually if you also use testEnvironmentOptions`);
        warnVerify(
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
          warnInfo(`slowTestThreshold was converted from Jest seconds to Vitest milliseconds.`);
        } else {
          test.raw.push(`// MANUAL: slowTestThreshold: ${source},`);
          warnManual(`slowTestThreshold is not a static number. Convert Jest seconds to Vitest milliseconds manually.`);
        }
        break;
      case 'bail':
        if (t.isBooleanLiteral(value)) {
          setScalar(test, 'bail', value.value ? '1' : '0');
          warnInfo(`bail ${source} was normalized to Vitest's numeric bail setting.`);
        } else {
          setScalar(test, 'bail', source);
        }
        break;
      case 'globalTeardown':
        test.raw.push(`// MANUAL: globalTeardown: ${source},`);
        warnManual(
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
              `snapshotFormat.${unsupported.join(', ')} is not supported by Vitest snapshotFormat. Use snapshotSerializers or set compareKeys: null where applicable.`
            );
          }
        }
        break;
      case 'prettierPath':
        warnInfo(`prettierPath has no Vitest equivalent. Vitest uses an internal serializer; remove if no longer needed.`);
        break;
      case 'setupFiles':
      case 'setupFilesAfterEnv':
        appendArray(test, 'setupFiles', source);
        if (key === 'setupFilesAfterEnv') {
          hasSetupFilesAfterEnv = true;
          test.noteFor.set(
            'setupFiles',
            `VERIFY: includes setupFilesAfterEnv — runs BEFORE tests in Vitest (unlike Jest); move framework-dependent calls accordingly`
          );
          warnVerify(
            `setupFilesAfterEnv runs after the test framework in Jest; in Vitest setupFiles runs before tests. Move framework-dependent calls (e.g. expect.extend) into a setup that imports vitest first.`
          );
        }
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
            warnInfo(`coverageProvider: 'babel' was mapped to Vitest's 'istanbul' coverage provider.`);
          } else if (value.value === 'v8' || value.value === 'istanbul' || value.value === 'custom') {
            setScalar(coverage, 'provider', source);
            selectedCoverageProvider = value.value;
            if (value.value === 'custom') {
              warnManual(`coverageProvider: 'custom' requires a Vitest custom coverage provider module.`);
            }
          } else {
            coverage.raw.push(`// MANUAL: coverage provider ${source} is not valid in Vitest.`);
            warnManual(
              `coverageProvider ${source} is not valid in Vitest. Use 'v8', 'istanbul', or 'custom'.`
            );
          }
        } else {
          coverage.raw.push(`// MANUAL: coverage provider ${source} could not be statically converted.`);
          warnManual(`coverageProvider value ${source} could not be statically converted.`);
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
          warnVerify(`moduleFileExtensions value was not a static array. Copy to resolve.extensions manually.`);
        }
        break;
      case 'moduleDirectories':
        setScalar(test, 'deps', `{ moduleDirectories: ${source} }`);
        test.noteFor.set('deps', `VERIFY: source aliasing belongs in resolve.alias; this controls mock/dependency resolution only`);
        warnVerify(
          `moduleDirectories was migrated to test.deps.moduleDirectories. Verify if you intended source resolution (use resolve.alias) versus mock/dependency resolution (test.deps.moduleDirectories).`
        );
        break;
      case 'modulePaths':
        warnManual(
          `modulePaths has no direct Vitest equivalent. For source aliasing add entries to resolve.alias; for dependency resolution use test.deps.moduleDirectories.`
        );
        break;
      case 'preset':
        if (t.isStringLiteral(value) && (value.value === 'ts-jest' || value.value.includes('ts-jest'))) {
          warnInfo(`preset '${value.value}' removed. Vitest handles TypeScript natively.`);
        } else if (t.isStringLiteral(value) && value.value.includes('babel-jest')) {
          warnInfo(`preset '${value.value}' removed. Vite handles transformation.`);
        } else if (t.isStringLiteral(value) && value.value.startsWith('.')) {
          hasMonorepoSignal = true;
          warnManual(
            `Relative preset '${value.value}' detected. In Vitest, share config via mergeConfig() from 'vitest/config' rather than presets.`
          );
        } else {
          warnManual(`preset ${source} has no direct Vitest equivalent.`);
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
                `transformIgnorePatterns entry ${JSON.stringify(el.value)} could not be parsed into package names. Add packages manually to test.server.deps.inline.`
              );
            }
          });
        } else {
          warnVerify(`transformIgnorePatterns was not a static array. Translate to test.server.deps.inline manually.`);
        }
        break;
      case 'automock':
        if (t.isBooleanLiteral(value)) {
          if (value.value) {
            hasMockingSignal = true;
            warnManual(
              `automock: true has no direct Vitest flag. Vitest auto-mocks only files inside __mocks__ adjacent to the source. Call vi.mock() per module instead.`
            );
            warnVerify(
              `Unlike Jest, Vitest does not auto-load root __mocks__ files unless vi.mock() is called. Put always-on mocks in setupFiles or add explicit vi.mock() calls.`
            );
          } else {
            warnInfo(`automock: false omitted. Vitest does not automock modules by default.`);
          }
        } else {
          hasMockingSignal = true;
          warnManual(`automock value ${source} could not be statically interpreted. Convert to per-module vi.mock() calls.`);
        }
        break;
      case 'resetMocks':
        hasMockingSignal = true;
        setScalar(test, 'mockReset', source);
        test.noteFor.set('mockReset', `VERIFY: mapped from Jest resetMocks — verify mock implementation reset semantics`);
        warnVerify(`resetMocks was mapped to Vitest mockReset. Verify mock implementation reset behavior on first run.`);
        break;
      case 'fakeTimers':
        if (t.isObjectExpression(value)) {
          let legacy = false;
          let enableGlobally: boolean | null = null;
          const keep: t.ObjectProperty[] = [];
          value.properties.forEach((p) => {
            if (!t.isObjectProperty(p)) {
              warnManual(`fakeTimers contains a non-static property that could not be converted.`);
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
              `fakeTimers.${subKey ?? 'unknown'} is not a Vitest fakeTimers config option. Move equivalent behavior to vi.useFakeTimers() or a setup file.`
            );
          });
          if (legacy) {
            warnManual(`fakeTimers.legacyFakeTimers has no equivalent in Vitest. Migrate timer usage to the modern fake timers API.`);
          }
          if (enableGlobally === true) {
            warnManual(
              `fakeTimers.enableGlobally: true cannot be represented as Vitest config. Add a setupFiles entry that imports vi from 'vitest' and calls vi.useFakeTimers() if global fake timers are still required.`
            );
          }
          if (enableGlobally === false) {
            warnInfo(`fakeTimers.enableGlobally: false omitted. Vitest only installs fake timers when vi.useFakeTimers() is called.`);
          }
          if (keep.length > 0) {
            setScalar(test, 'fakeTimers', `{ ${keep.map((p) => generate(p).code).join(', ')} }`);
          }
        } else {
          warnManual(`fakeTimers value ${source} is not a static object. Verify the migration manually.`);
        }
        break;
      case 'timers':
        if (t.isStringLiteral(value) && value.value === 'legacy') {
          warnManual(
            `timers: 'legacy' has no Vitest equivalent. Replace with modern fake timers (vi.useFakeTimers()) in tests that need them.`
          );
        } else if (t.isStringLiteral(value) && value.value === 'fake') {
          warnManual(
            `timers: 'fake' globally installed fake timers in Jest. Vitest has no config flag for this; call vi.useFakeTimers() in setupFiles or individual tests.`
          );
        } else {
          warnInfo(`timers: ${source} has no direct mapping. Use vi.useFakeTimers() per test instead.`);
        }
        break;
      case 'maxWorkers': {
        setScalar(test, 'maxWorkers', source);
        const isOne = t.isNumericLiteral(value) && value.value === 1;
        if (isOne) {
          setScalar(test, 'isolate', 'false');
          warnVerify(`maxWorkers: 1 detected. Added isolate: false to avoid the 2x slowdown observed in Vitest 4.`);
        }
        break;
      }
      case 'runInBand':
        setScalar(test, 'maxWorkers', '1');
        setScalar(test, 'isolate', 'false');
        warnInfo(`runInBand is a Jest CLI flag. Mapped to maxWorkers: 1, isolate: false.`);
        break;
      case 'workerIdleMemoryLimit':
        setScalar(test, 'vmMemoryLimit', source);
        break;
      case 'verbose':
        if (t.isBooleanLiteral(value) && value.value === true) {
          appendArray(test, 'reporters', `['verbose']`);
        } else if (t.isBooleanLiteral(value) && value.value === false) {
          appendArray(test, 'reporters', `['default']`);
        } else {
          warnInfo(`verbose value ${source} could not be mapped. Set test.reporters explicitly.`);
        }
        break;
      case 'reporters':
        if (t.isArrayExpression(value)) {
          appendArray(test, 'reporters', source);
          test.noteFor.set('reporters', `VERIFY: Jest and Vitest built-in reporter names differ (default/verbose/dot/json/junit/tap/html)`);
          warnVerify(
            `reporters were copied verbatim. Jest and Vitest built-in reporter names differ (e.g. 'default', 'verbose', 'dot', 'json', 'junit', 'tap', 'html').`
          );
        } else {
          warnManual(`reporters value ${source} is not a static array. Re-author for Vitest's reporter API.`);
        }
        break;
      case 'testSequencer':
        test.raw.push(`// MANUAL: testSequencer: ${source},`);
        warnManual(
          `testSequencer cannot be copied directly. Vitest's sequence.sequencer expects a Vitest-compatible sequencer constructor from 'vitest/node'. Port the sequencer module manually.`
        );
        break;
      case 'randomize':
        if (t.isBooleanLiteral(value)) {
          setSequence('shuffle', String(value.value));
          warnInfo(`randomize was mapped to Vitest sequence.shuffle.`);
        } else {
          test.raw.push(`// MANUAL: randomize: ${source},`);
          warnManual(`randomize value ${source} could not be statically converted to sequence.shuffle.`);
        }
        break;
      case 'showSeed':
        if (t.isBooleanLiteral(value) && value.value) {
          warnInfo(`showSeed: true has no direct Vitest config equivalent. Use Vitest's seed/sequence options and CLI output when reproducing shuffled runs.`);
        } else if (t.isBooleanLiteral(value)) {
          warnInfo(`showSeed: false omitted.`);
        } else {
          warnVerify(`showSeed value ${source} could not be statically interpreted. Review Vitest seed output manually.`);
        }
        break;
      case 'detectOpenHandles':
      case 'detectLeaks':
        warnVerify(
          `${key} has no direct Vitest flag. Run with --logHeapUsage and consider the verbose reporter to surface stuck handles or leaks.`
        );
        break;
      case 'poolOptions':
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
            mappedSingle
              ? `poolOptions was removed in Vitest 4. Mapped singleThread/singleFork to maxWorkers: 1, isolate: false.`
              : `poolOptions was removed in Vitest 4. Move equivalent settings to the top-level test config (maxWorkers, isolate, pool).`
          );
        } else {
          warnInfo(`poolOptions was removed in Vitest 4. Move equivalent settings to top-level test config.`);
        }
        break;
      case 'watchPathIgnorePatterns':
        warnManual(
          `watchPathIgnorePatterns has no Vitest test-config equivalent. Use Vite's server.watch.ignored in vite.config.ts.`
        );
        break;
      case 'unmockedModulePathPatterns':
        hasMockingSignal = true;
        warnManual(`${key} has no equivalent in Vitest.`);
        break;
      case 'watchPlugins':
      case 'testRunner':
      case 'dependencyExtractor':
      case 'haste':
      case 'resolver':
        warnManual(`${key} has no equivalent in Vitest.`);
        break;
      case 'globals':
        if (t.isObjectExpression(value)) {
          handleGlobalsObject(value);
        } else if (t.isBooleanLiteral(value) && value.value === true) {
          setScalar(test, 'globals', 'true');
          usesGlobalsTrue = true;
          warnInfo(
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
            warnInfo(`injectGlobals: true was mapped to Vitest globals: true.`);
          } else {
            warnInfo(`injectGlobals: false omitted. Vitest uses explicit imports by default.`);
          }
        } else {
          test.raw.push(`// MANUAL: injectGlobals: ${source},`);
          warnManual(`injectGlobals value ${source} could not be statically converted.`);
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
        warnInfo(`${key} is unnecessary or removed in Vitest 4.`);
        break;
      case 'projects':
        setScalar(test, 'projects', source);
        hasMonorepoSignal = true;
        warnInfo(`In Vitest 4, workspaces must be inline via test.projects. Do not generate a vitest.workspace.ts file.`);
        break;
      case 'displayName':
        setScalar(test, 'name', source);
        break;
      case 'cacheDirectory':
      case 'cache':
        warnInfo(`${key} is managed by Vite/Vitest internally; usually safe to drop.`);
        break;
      case 'modulePathIgnorePatterns':
        test.raw.push(`// MANUAL: modulePathIgnorePatterns: ${source},`);
        warnManual(
          `modulePathIgnorePatterns has no direct Vitest equivalent. Review whether these paths should be excluded from test.include/test.exclude, coverage.exclude, or Vite resolution.`
        );
        break;
      case 'resetModules':
        warnVerify(
          `resetModules controls Jest's module registry reset behavior. Vitest has vi.resetModules() for per-test use; verify module isolation expectations manually.`
        );
        break;
      case 'snapshotResolver':
        test.raw.push(`// MANUAL: snapshotResolver: ${source},`);
        warnManual(
          `snapshotResolver cannot be copied directly. Vitest uses resolveSnapshotPath with a different function signature; port the resolver manually.`
        );
        break;
      case 'testResultsProcessor':
        test.raw.push(`// MANUAL: testResultsProcessor: ${source},`);
        warnManual(
          `testResultsProcessor has no direct Vitest equivalent. Replace it with a Vitest reporter or post-processing step.`
        );
        break;
      case 'waitForUnhandledRejections':
        warnVerify(
          `waitForUnhandledRejections has no direct Vitest config equivalent. Vitest handles unhandled rejections differently; verify async rejection failures on first run.`
        );
        break;
      default:
        test.raw.push(`// UNMAPPED: ${key}: ${source},`);
        warnManual(`Unmapped Jest field '${key}' was preserved as a comment. Review and migrate manually.`);
    }
  });

  // Coverage subsection cleanup: nested coverage.all / coverage.ignoreEmptyLines flags from Jest
  // are not nested under top-level keys in Jest itself — we surface guidance only when the user
  // had a Vitest-style coverage object passed through. For Jest input there is no nested
  // coverage object, so we skip that. We do, however, warn for legacy Vitest carryover values
  // when scanning the raw input for these tokens.
  if (/\bcoverage\.all\b/.test(input) || /coverage:\s*{[^}]*\ball:/.test(input)) {
    warnInfo(`coverage.all was removed in Vitest 4. Replace with coverage.include patterns.`);
  }
  if (/\bcoverage\.ignoreEmptyLines\b/.test(input) || /coverage:\s*{[^}]*\bignoreEmptyLines:/.test(input)) {
    warnInfo(`coverage.ignoreEmptyLines was removed in Vitest 4 (always true).`);
  }

  // ---- Behavioral migration warnings (apply regardless of mapped fields). ----
  // These cover Jest-vs-Vitest semantic differences that the config alone cannot fully express.

  // 1. vi.mock factory hoisting — surfaced when any mocking-related signal is present.
  if (hasMockingSignal) {
    warnVerify(
      `vi.mock() factories are hoisted to the top of the file. Variables declared in the surrounding scope are NOT available inside the factory. Wrap them with vi.hoisted() or move them inside the factory.`
    );
  }

  // 2. Hook execution order — surfaced when setup files or global hooks are present.
  if (hasSetupFilesAfterEnv || test.scalars.has('globalSetup') || test.scalars.has('globalTeardown')) {
    warnInfo(
      `Hook execution order: Vitest defaults to parallel hook execution within a file. If your tests rely on Jest's strict sequential beforeAll/beforeEach order, set sequence.hooks: 'list' on the test config.`
    );
  }

  // 3. done callback removal — surfaced when legacy setup patterns are likely.
  if (hasSetupFilesAfterEnv) {
    warnInfo(
      `Vitest does not support the 'done' callback in tests or hooks. Convert any 'done' usage to async/await or return a promise.`
    );
  }

  // 4. expect.getState().currentTestName separator change — generic behavioral note.
  warnInfo(
    `If any code reads expect.getState().currentTestName, note Jest joins describe/test names with a space while Vitest uses ' > '. Adjust string-matching logic accordingly.`
  );

  // 5. Framework-specific snapshot serializer warning.
  if (hasFrameworkSerializer) {
    warnVerify(
      `Framework-specific snapshot serializer detected (e.g. enzyme-to-json, jest-serializer-vue). Verify the snapshot output is byte-identical under Vitest. Some serializers depend on Jest internals and may need a Vitest-compatible replacement.`
    );
  }

  // 6. No 'jest' namespace types — important for TypeScript users.
  if (looksLikeTypeScript || usesGlobalsTrue) {
    warnInfo(
      `Vitest has no global 'jest' namespace. Replace 'jest.fn()', 'jest.spyOn()', 'jest.mock()', and 'jest.Mock' types with the equivalent 'vi' import from 'vitest', and update tsconfig types accordingly.`
    );
  }

  // Snapshot regeneration is an informational note — it's an action the user runs
  // (vitest run --update), not a semantic mismatch they need to verify.
  warnInfo(`Snapshot regeneration is required on first run (format change from Jest).`);

  // ---- Output assembly ----
  if (needsTsconfigPaths) {
    rootImports.push(`import tsconfigPaths from 'vite-tsconfig-paths';`);
    rootPlugins.push(`tsconfigPaths()`);
    warnManual(`pathsToModuleNameMapper detected. Included vite-tsconfig-paths. Run: npm i -D vite-tsconfig-paths`);
  }

  // Build define output.
  const defineEntries = Array.from(define.entries()).map(([k, v]) => `${quoteKey(k)}: ${v}`);

  // Build coverage block (only if any coverage entries).
  const coverageLines = renderSection(coverage, '  ', format);
  if (coverageLines.length > 0) {
    test.raw.push('coverage: {');
    coverageLines.forEach((line) => test.raw.push(line));
    test.raw.push('},');
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
  if (resolveAlias.size > 0 || resolveExtensions.length > 0) {
    lines.push(`  resolve: {`);
    if (resolveAlias.size > 0) {
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
  if (testLines.length > 0) {
    lines.push(`  test: {`);
    testLines.forEach((line) => lines.push(line));
    lines.push(`  },`);
  }
  lines.push(`});`);

  // Tailored next steps.
  tailoredNextSteps.push(`npm uninstall jest @types/jest ts-jest babel-jest`);
  tailoredNextSteps.push(`npm install -D vitest`);
  if (needsCoverage && selectedCoverageProvider !== 'custom') {
    tailoredNextSteps.push(
      selectedCoverageProvider === 'istanbul'
        ? `npm install -D @vitest/coverage-istanbul`
        : `npm install -D @vitest/coverage-v8`
    );
  }
  if (needsJsdom) tailoredNextSteps.push(`npm install -D jsdom`);
  if (needsHappyDom) tailoredNextSteps.push(`npm install -D happy-dom`);
  if (needsTsconfigPaths) tailoredNextSteps.push(`npm install -D vite-tsconfig-paths`);
  if (needsSvgr) tailoredNextSteps.push(`npm install -D vite-plugin-svgr`);
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
          warnManual(`moduleNameMapper entry '${aliasKey}' has an empty fallback array. Add the equivalent resolve.alias manually.`);
          return;
        }
        if (!t.isStringLiteral(first)) {
          warnManual(`moduleNameMapper entry '${aliasKey}' uses a non-string fallback array. Add the equivalent resolve.alias manually.`);
          return;
        }
        aliasValueNode = first;
        if (fallbackCount > 1) {
          warnVerify(
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
            `SVG-to-component transformer (${aliasVal}) detected for ${aliasKey}. Replaced with the vite-plugin-svgr plugin; import SVGs as React components via './foo.svg?react'. The install step is added to the next-steps block.`
          );
        } else {
          warnVerify(
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
          `Font stub for ${aliasKey} detected. Vite handles font URLs natively. Drop the stub.`
        );
        return;
      }

      // Plain alias (path or package redirect).
      let cleanKey = aliasKey.replace(/^\^/, '').replace(/\$$/, '');
      if (cleanKey.endsWith('/(.*)')) cleanKey = cleanKey.replace(/\/\(\.\*\)$/, '');
      else if (cleanKey.endsWith('(.*)')) cleanKey = cleanKey.replace(/\(\.\*\)$/, '');

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
        warnInfo(`globals['ts-jest'] dropped. Vitest handles TypeScript via Vite; no ts-jest config needed.`);
        return;
      }
      define.set(subKey, getSourceCode(p.value as t.Node));
    });
    warnManual(
      `Jest 'globals' object values were moved to root-level Vite 'define'. Note that 'globals: true' in Vitest exposes test APIs and is unrelated to injected constants.`
    );
  }

  function handleCoverageThreshold(value: t.Node, source: string) {
    if (!t.isObjectExpression(value)) {
      setScalar(coverage, 'thresholds', source);
      warnManual(`coverageThreshold value ${source} is not a static object. Verify coverage.thresholds manually.`);
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
      warnManual(`coverageThreshold.global could not be unwrapped. Verify coverage.thresholds manually.`);
      return;
    }

    setScalar(coverage, 'thresholds', `{ ${thresholdEntries.join(', ')} }`);
    coverage.noteFor.set('thresholds', `VERIFY: V8 AST remapping in Vitest 4 may shift previously-passing thresholds — re-baseline${sawPathThreshold ? '; path thresholds: Vitest keeps matching files in global thresholds' : ''}`);

    if (sawGlobal) {
      warnInfo(`coverageThreshold.global was unwrapped into Vitest coverage.thresholds.`);
    }
    if (sawPathThreshold) {
      warnVerify(
        `Jest subtracts path/glob coverageThreshold groups from global thresholds. Vitest keeps matching files in global thresholds, so review mixed global and path thresholds.`
      );
    }
    if (hadDynamic) {
      warnManual(`Some dynamic coverageThreshold entries could not be converted. Review coverage.thresholds manually.`);
    }
  }

  function handleCoverageIncludePatterns(value: t.Node, source: string) {
    if (!t.isArrayExpression(value)) {
      appendArray(coverage, 'include', source);
      warnVerify(`collectCoverageFrom was not a static array. Verify coverage.include manually, especially any negated patterns.`);
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
      warnInfo(`Negated collectCoverageFrom patterns were moved to coverage.exclude.`);
    }
    if (dynamic) {
      warnManual(`Some collectCoverageFrom entries were dynamic. Verify coverage.include and coverage.exclude manually.`);
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
      warnManual(`${sourceKey} is not a static array. Convert regex path ignores to Vitest glob excludes manually.`);
      return;
    }

    const converted: string[] = [];
    value.elements.forEach((el) => {
      if (!t.isStringLiteral(el)) {
        if (el) section.raw.push(`// MANUAL: ${sourceKey} entry ${getSourceCode(el as t.Node)}`);
        warnManual(`${sourceKey} contains a dynamic entry. Convert it to a Vitest glob manually.`);
        return;
      }

      const glob = convertSimpleIgnorePatternToGlob(el.value);
      if (glob) {
        converted.push(JSON.stringify(glob));
      } else {
        section.raw.push(`// MANUAL: ${sourceKey} regex ${JSON.stringify(el.value)} was not copied to ${targetKey}.`);
        warnVerify(
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
      warnInfo(`transform value ${getSourceCode(value)} could not be inspected. Vite handles most transforms natively.`);
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

      if (typeof targetSrc === 'string' && (targetSrc.includes('ts-jest') || targetSrc.includes('babel-jest'))) {
        dropped++;
        return;
      }
      // File-stub transforms (e.g. jest-transform-stub, jest-svg-transformer) usually become Vite plugins or are unnecessary.
      if (typeof targetSrc === 'string' && /transform-stub|svg-transformer|file-transformer/.test(targetSrc)) {
        warnVerify(
          `transform entry '${matcher}' uses a file-stub transformer (${targetSrc}). Replace with the appropriate Vite plugin or rely on Vite's asset handling.`
        );
        return;
      }
      warnManual(
        `transform entry '${matcher}' -> ${typeof targetSrc === 'string' ? targetSrc : 'custom transformer'} has no direct equivalent. Replace with a Vite plugin or migrate the transformer.`
      );
    });
    if (dropped > 0) {
      warnInfo(`Dropped ${dropped} ts-jest/babel-jest transform entr${dropped === 1 ? 'y' : 'ies'}. Vite handles them natively.`);
    }
  }
}

function emptyFlags(): ConversionFlags {
  return {
    monorepo: false,
    embeddedParent: null,
    needsCoverage: false,
    needsJsdom: false,
    needsHappyDom: false,
    needsTsconfigPaths: false,
    needsSvgr: false,
    usesGlobalsTrue: false,
  };
}

function quoteKey(key: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) return key;
  if (!key.includes("'") && !/[\\\n\r\t]/.test(key)) return `'${key}'`;
  return JSON.stringify(key);
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
    const stripped = node.value.replace(/<rootDir>\/?/g, './');
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
  return generate(node, { compact: false, jsescOption: { quotes: 'single' } })
    .code.replace(/<rootDir>\/?/g, './')
    .replace(/\n\s*/g, ' ')
    .trim();
}

// Extract package names from common Jest transformIgnorePatterns regex shapes:
//   'node_modules/(?!(swiper|nanoid)/)'   -> ['swiper', 'nanoid']
//   'node_modules/(?!swiper)/'            -> ['swiper']
//   'node_modules/(?!(@scope/pkg|other))' -> ['@scope/pkg', 'other']
function extractPackagesFromIgnorePattern(pattern: string): string[] {
  const negLookahead = /\(\?!\(?([^)]+)\)?/;
  const match = pattern.match(negLookahead);
  if (!match) return [];
  return match[1]
    .split('|')
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.includes('/('))
    .map((p) => p.replace(/\/$/, ''));
}

function convertSimpleIgnorePatternToGlob(pattern: string): string | null {
  const normalized = pattern.replace(/<rootDir>\/?/g, '').replace(/^\.\//, '');
  if (!normalized) return null;
  if (/[\\^$()+?|[\]{}]/.test(normalized)) return null;
  if (normalized.includes('*')) return normalized;
  if (normalized.endsWith('/')) return `${normalized}**`;
  return normalized;
}
