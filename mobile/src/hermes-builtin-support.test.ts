import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
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

  it('finds none in mobile production sources', () => {
    const found = ['src', 'app'].flatMap((folder) =>
      productionFiles(join(mobileRoot, folder)).flatMap((path) =>
        missingHermesBuiltinCalls(relative(mobileRoot, path), readFileSync(path, 'utf8'))
      )
    )
    expect(found).toEqual([])
  })
})
