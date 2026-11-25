import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Why: vitest runs on Node, which has these; Hermes 0.14.1 (RN 0.83, see its PredefinedStrings.def) does not,
// so a call passes CI and throws "is not a function" on the phone. Set's union/intersection/... are
// missing too but left out: by name alone they match zod's z.union().
const MISSING_INSTANCE_METHODS = new Set(['toSorted', 'isWellFormed', 'toWellFormed'])
const MISSING_STATIC_METHODS = new Set([
  'Object.groupBy',
  'Map.groupBy',
  'Array.fromAsync',
  'Promise.withResolvers'
])

const mobileRoot = fileURLToPath(new URL('..', import.meta.url))
const sourceExtension = /\.[jt]sx?$/
const testOnlyFile = /\.test\.[jt]sx?$|-test-(?:harness|fakes)\.[jt]sx?$/

function mobileTsconfig(): ts.ParsedCommandLine {
  const configPath = join(mobileRoot, 'tsconfig.json')
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile)
  return ts.parseJsonConfigFileContent(config, ts.sys, mobileRoot, undefined, configPath)
}

// Why: `import type` is erased before Metro bundles, so only value imports reach the phone.
function runtimeImportSpecifiers(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const specifiers: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings
      const allTypeSpecifiers =
        !node.importClause?.name &&
        bindings !== undefined &&
        ts.isNamedImports(bindings) &&
        bindings.elements.length > 0 &&
        bindings.elements.every((element) => element.isTypeOnly)
      if (!node.importClause?.isTypeOnly && !allTypeSpecifiers) {
        specifiers.push(node.moduleSpecifier.text)
      }
    } else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

const assetSpecifier = /\.(?:png|jpe?g|gif|webp|svg|ttf|otf|mp3|wav)$/

// Why: TS resolves to forward slashes on every platform; compare paths in that form.
const slashPath = (path: string): string => path.split(sep).join('/')

// Why: mobile bundles repo-root src/shared modules (see metro.config.js), so follow the import
// graph out of mobile/ instead of keeping a hand list that the next import silently outgrows.
function sharedRuntimeFiles(entryFiles: string[]): { files: string[]; unresolved: string[] } {
  const { options } = mobileTsconfig()
  const seen = new Set(entryFiles)
  const queue = [...entryFiles]
  const unresolved: string[] = []
  for (let path = queue.pop(); path !== undefined; path = queue.pop()) {
    for (const specifier of runtimeImportSpecifiers(path, readFileSync(path, 'utf8'))) {
      const resolved = ts.resolveModuleName(specifier, path, options, ts.sys).resolvedModule
      // A local import the resolver drops would hide its whole subtree from the scan.
      if (!resolved && /^(?:\.|@\/)/.test(specifier) && !assetSpecifier.test(specifier)) {
        unresolved.push(`${relative(mobileRoot, path)} -> ${specifier}`)
      }
      if (
        resolved &&
        !resolved.isExternalLibraryImport &&
        sourceExtension.test(resolved.resolvedFileName) &&
        !resolved.resolvedFileName.endsWith('.d.ts') &&
        !seen.has(resolved.resolvedFileName)
      ) {
        seen.add(resolved.resolvedFileName)
        queue.push(resolved.resolvedFileName)
      }
    }
  }
  const entries = new Set(entryFiles)
  return { files: [...seen].filter((path) => !entries.has(path)), unresolved }
}

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return productionFiles(path)
    }
    return sourceExtension.test(entry.name) && !testOnlyFile.test(entry.name) ? [path] : []
  })
}

function missingHermesBuiltinCalls(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const { expression: receiver, name } = node.expression
      const qualified = ts.isIdentifier(receiver) ? `${receiver.text}.${name.text}` : ''
      const label = MISSING_STATIC_METHODS.has(qualified)
        ? qualified
        : MISSING_INSTANCE_METHODS.has(name.text)
          ? `.${name.text}`
          : null
      if (label) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(name.getStart())
        found.push(`${fileName}:${line + 1} ${label}()`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

describe('Hermes built-in support', () => {
  it('flags calls Hermes lacks and leaves supported ES2023 methods alone', () => {
    const source = [
      'xs.toSorted(cmp)',
      'Object.groupBy(xs, key)',
      'xs.findLast(Boolean)',
      'xs.toReversed()',
      '[...xs].sort(cmp)'
    ].join('\n')
    expect(missingHermesBuiltinCalls('probe.ts', source)).toEqual([
      'probe.ts:1 .toSorted()',
      'probe.ts:2 Object.groupBy()'
    ])
  })

  it('follows value imports and skips type-only ones', () => {
    const source = [
      "import type { A } from './type-only'",
      "import { type B, type C } from './all-type-specifiers'",
      "import { type D, e } from './mixed'",
      "import f from './default'",
      "import './side-effect'",
      "export { g } from './re-export'",
      "export type { H } from './type-re-export'",
      "const i = require('./required')",
      "const j = import('./lazy')"
    ].join('\n')
    expect(runtimeImportSpecifiers('probe.ts', source)).toEqual([
      './mixed',
      './default',
      './side-effect',
      './re-export',
      './required',
      './lazy'
    ])
  })

  it('finds none in mobile production sources or the src/shared modules they import', () => {
    // Why the app tsconfig's files: one it excludes, the Team scene engine, runs in a WebView.
    const appFiles = new Set(mobileTsconfig().fileNames.map(slashPath))
    const entryFiles = ['src', 'app']
      .flatMap((folder) => productionFiles(join(mobileRoot, folder)).map(slashPath))
      .filter((path) => appFiles.has(path))
    const { files: sharedFiles, unresolved } = sharedRuntimeFiles(entryFiles)
    // Guards the walker itself: a resolver that stops at mobile/ would pass with nothing to scan.
    expect(unresolved).toEqual([])
    expect(sharedFiles.some((path) => path.includes('/src/shared/'))).toBe(true)
    const found = [...entryFiles, ...sharedFiles].flatMap((path) =>
      missingHermesBuiltinCalls(relative(mobileRoot, path), readFileSync(path, 'utf8'))
    )
    expect(found).toEqual([])
    // Why 30 s: it parses every production file; a green CI run took 3.4 s of the default 5 s.
  }, 30_000)
})
