import fs from 'node:fs'
import path from 'node:path'

/**
 * Reads every `translate(key, fallback)` call in the renderer and compares each
 * fallback against the catalog value its key resolves to.
 *
 * The renderer bundles `en.json` as an i18next resource, so a present catalog
 * value beats the English fallback. When #303 renamed the product in the
 * catalogs, every source fallback still saying the old name became copy that no
 * longer renders — invisible in the UI, fatal to any test asserting the fallback
 * text (ORCA-443). The main process has the opposite wiring (empty `en`
 * resource, fallback wins), which is why this is renderer-only.
 *
 * Test files are excluded: their `translate()` calls are fixtures, not product
 * copy, so no rebranding slice can ever retire one. They carry 0 of the 591
 * stale fallbacks and contribute the only key that resolves to nothing.
 */

const RENDERER_ROOT = 'src/renderer/src'
const CATALOG = `${RENDERER_ROOT}/i18n/locales/en.json`

// Split so this file is not itself a match for the name it searches for.
const OLD_NAME = 'Or' + 'ca'
export const NEW_NAME = `${OLD_NAME} Lab`
const RENAME = new RegExp(`\\b${OLD_NAME}\\b(?! Lab)`, 'g')

const isTestFile = (file) => /\.(test|spec)\.(ts|tsx)$/.test(file)

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      yield* walk(absolute)
      continue
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !isTestFile(entry.name)) {
      yield absolute
    }
  }
}

/** Decodes the JS string literal at `source[start]`, or null if not one. */
export function readStringLiteral(source, start) {
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
    // An interpolated template is not a static fallback this parser can read.
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
export function readStringExpression(source, start) {
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

/** Every `translate('key', 'fallback')` call the parser can read statically. */
export function collectFallbacks(root = process.cwd()) {
  const calls = []
  for (const absolute of walk(path.join(root, RENDERER_ROOT))) {
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
        file: path.relative(path.join(root, RENDERER_ROOT), absolute).split(path.sep).join('/'),
        line: source.slice(0, match.index).split('\n').length,
        key: key.value,
        fallback: fallback.value
      })
    }
  }
  return calls
}

export function readCatalog(root = process.cwd()) {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, CATALOG), 'utf8'))
  return (key) => {
    const value = key
      .split('.')
      .reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), catalog)
    return typeof value === 'string' ? value : undefined
  }
}

/**
 * The three numbers the baseline pins.
 *
 * `renameDrift` is the subset of `stale` whose catalog value is exactly the
 * fallback with the product renamed — the work ORCA-443 retires. `stale` is
 * every fallback that does not match its catalog value at all, so it also
 * covers copy that diverged for other reasons, and it is what makes a sub-brand
 * the catalog deliberately leaves alone (`${OLD_NAME} Relay`) correct rather
 * than stale.
 */
export function measure(root = process.cwd()) {
  const calls = collectFallbacks(root)
  const lookup = readCatalog(root)
  const unresolved = []
  const stale = []
  const renameDrift = []
  for (const call of calls) {
    const value = lookup(call.key)
    if (value === undefined) {
      unresolved.push(call)
      continue
    }
    if (value === call.fallback) {
      continue
    }
    stale.push(call)
    if (value === call.fallback.replaceAll(RENAME, NEW_NAME)) {
      renameDrift.push(call)
    }
  }
  return {
    calls,
    unresolved,
    stale,
    renameDrift,
    counts: {
      'rename-drift': renameDrift.length,
      'stale-fallbacks': stale.length,
      'resolved-calls': calls.length - unresolved.length
    }
  }
}
