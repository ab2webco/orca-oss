import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The renderer bundles `en.json` as an i18next resource, so a present catalog
 * value beats the English `translate()` fallback. When #303 renamed the product
 * in the catalogs, every source fallback still saying the old name became copy
 * that no longer renders — invisible in the UI, fatal to any test asserting the
 * fallback text (ORCA-443). The main process has the opposite wiring (empty `en`
 * resource, fallback wins), which is why this guard is renderer-only.
 */
const REPO_ROOT = path.join(import.meta.dirname, '..', '..')
const RENDERER_ROOT = path.join(REPO_ROOT, 'src/renderer/src')
const CATALOG = path.join(RENDERER_ROOT, 'i18n/locales/en.json')

// Split so this file is not itself a match for the name it searches for.
const OLD_NAME = 'Or' + 'ca'
const NEW_NAME = `${OLD_NAME} Lab`
const RENAME = new RegExp(`\\b${OLD_NAME}\\b(?! Lab)`, 'g')
// Same pattern without /g: `test()` on a global regex advances lastIndex, so
// reusing RENAME across calls would skip matches.
const HAS_OLD_NAME = new RegExp(`\\b${OLD_NAME}\\b(?! Lab)`)

// Paths whose fallbacks are fully realigned. Each slice of ORCA-443 moves its
// surface in here and drops KNOWN_DRIFT_SITES by the same amount.
const REALIGNED_PATHS = [
  /^components\/feature-wall\//,
  /^components\/settings\/BrowserUse/,
  /^components\/settings\/browser-use/
]

// Remaining un-realigned fallbacks, pinned exactly: a new drift anywhere pushes
// this over, and realigning one without moving its path above pushes it under.
// This pin, not the parsed-call floor below, is what catches a parser that stops
// reading a literal shape repository-wide.
const KNOWN_DRIFT_SITES = 608

// Floor on the calls the parser reads inside the realigned surface. Without it
// the surface has no coverage canary of its own: a parser regression scoped to
// these paths, a fallback moved behind a constant key, or a fallback turned into
// an interpolated template all drop out of `calls` silently, and the assertions
// below would then pass while covering nothing. A floor rather than an equality
// pin so that adding a translate() call here is not a failing build; the
// key-resolves check next to it is what keeps the floor honest.
const REALIGNED_PARSED_CALLS = 303

// Repository-wide floor. Deliberately loose — it only catches a parser that
// stops matching almost everything.
const MIN_PARSED_CALLS = 12_000

const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'))

function lookup(key) {
  const value = key
    .split('.')
    .reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), catalog)
  return typeof value === 'string' ? value : undefined
}

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      yield* walk(absolute)
      continue
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      yield absolute
    }
  }
}

/** Decodes the JS string literal at `source[start]`, or null if not one. */
function readStringLiteral(source, start) {
  const quote = source[start]
  if (quote !== "'" && quote !== '"' && quote !== '`') {
    return null
  }
  let value = ''
  let index = start + 1
  while (index < source.length) {
    const char = source[index]
    if (char === '\\') {
      const next = source[index + 1]
      if (next === 'n') {
        value += '\n'
      } else if (next === 't') {
        value += '\t'
      } else if (next === 'r') {
        value += '\r'
      } else if (next === '\n') {
        value += ''
      } else if (next === 'u' && source[index + 2] === '{') {
        const close = source.indexOf('}', index + 3)
        value += String.fromCodePoint(Number.parseInt(source.slice(index + 3, close), 16))
        index = close + 1
        continue
      } else if (next === 'u') {
        value += String.fromCharCode(Number.parseInt(source.slice(index + 2, index + 6), 16))
        index += 6
        continue
      } else if (next === 'x') {
        value += String.fromCharCode(Number.parseInt(source.slice(index + 2, index + 4), 16))
        index += 4
        continue
      } else {
        value += next
      }
      index += 2
      continue
    }
    if (char === quote) {
      return { value, end: index + 1 }
    }
    // An interpolated template is not a static fallback this guard can read.
    if (quote === '`' && char === '$' && source[index + 1] === '{') {
      return null
    }
    value += char
    index++
  }
  return null
}

function skipWhitespace(source, index) {
  let cursor = index
  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor++
  }
  return cursor
}

/** Reads a string literal or a `+`-concatenated chain of them. */
function readStringExpression(source, start) {
  const first = readStringLiteral(source, start)
  if (!first) {
    return null
  }
  let value = first.value
  let end = first.end
  for (;;) {
    let cursor = skipWhitespace(source, end)
    if (source[cursor] !== '+') {
      return { value, end }
    }
    cursor = skipWhitespace(source, cursor + 1)
    const next = readStringLiteral(source, cursor)
    if (!next) {
      return { value, end }
    }
    value += next.value
    end = next.end
  }
}

function collectFallbacks() {
  const calls = []
  for (const absolute of walk(RENDERER_ROOT)) {
    const source = fs.readFileSync(absolute, 'utf8')
    const pattern = /\btranslate\s*\(/g
    let match
    while ((match = pattern.exec(source))) {
      let cursor = skipWhitespace(source, match.index + match[0].length)
      const key = readStringExpression(source, cursor)
      if (!key) {
        continue
      }
      cursor = skipWhitespace(source, key.end)
      if (source[cursor] !== ',') {
        continue
      }
      cursor = skipWhitespace(source, cursor + 1)
      const fallback = readStringExpression(source, cursor)
      if (!fallback) {
        continue
      }
      calls.push({
        file: path.relative(RENDERER_ROOT, absolute).split(path.sep).join('/'),
        line: source.slice(0, match.index).split('\n').length,
        key: key.value,
        fallback: fallback.value
      })
    }
  }
  return calls
}

const calls = collectFallbacks()

// Only pure-rename drift: the catalog value must be exactly the fallback with
// the product renamed. Fallbacks that diverge for any other reason are copy
// changes this guard does not own.
const renameDrift = calls.filter((call) => {
  const value = lookup(call.key)
  if (value === undefined || value === call.fallback) {
    return false
  }
  return value === call.fallback.replaceAll(RENAME, NEW_NAME)
})

const isRealigned = (file) => REALIGNED_PATHS.some((pattern) => pattern.test(file))

describe(`renderer translate() fallbacks follow the ${NEW_NAME} catalog`, () => {
  it('parses the renderer translate() calls it claims to cover', () => {
    expect(calls.length).toBeGreaterThan(MIN_PARSED_CALLS)
  })

  it('still reads every fallback shape in the realigned surface', () => {
    const realigned = calls.filter((call) => isRealigned(call.file))
    expect(realigned.length).toBeGreaterThanOrEqual(REALIGNED_PARSED_CALLS)
    // A floor alone would pass a call whose key is absent from the catalog:
    // nothing overrides it, so it renders its fallback and no drift exists to
    // find. Requiring every key to resolve is what makes the floor mean
    // "covered" rather than merely "counted".
    const unresolved = realigned
      .filter((call) => lookup(call.key) === undefined)
      .map((call) => `${call.file}:${call.line} ${call.key}`)
    expect(unresolved).toEqual([])
  })

  it('has no stale fallback left in a realigned surface', () => {
    // Not `renameDrift`: that only sees a fallback whose catalog value is
    // exactly the renamed fallback, so one extra character ("Get to know
    // Orca!") drops out of it and would pass. In a surface claimed as
    // realigned the bare old name is wrong on its own terms.
    const stale = calls
      .filter((call) => isRealigned(call.file) && HAS_OLD_NAME.test(call.fallback))
      .map((call) => `${call.file}:${call.line} ${JSON.stringify(call.fallback)}`)
    expect(stale).toEqual([])
  })

  it('holds the un-realigned fallbacks at their pinned count', () => {
    const remaining = renameDrift.filter((call) => !isRealigned(call.file))
    expect(remaining).toHaveLength(KNOWN_DRIFT_SITES)
  })
})
