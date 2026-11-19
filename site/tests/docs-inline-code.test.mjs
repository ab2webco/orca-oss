import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { DIST_DIR, listBuiltFiles } from './support/built-html.mjs'

// Inline code in the docs must not break inside a flag: `--` on one line and `past-busy` on the
// next, or `-` and `-repo`.
describe('docs inline code', () => {
  const pages = listBuiltFiles(path.join(DIST_DIR, 'docs'))
    .concat(listBuiltFiles(path.join(DIST_DIR, 'es', 'docs')))
    .filter((file) => file.endsWith('.html'))

  it('keeps every flag in one unbreakable word', () => {
    let flags = 0
    for (const file of pages) {
      const html = readFileSync(file, 'utf8').replace(/<pre\b[\s\S]*?<\/pre>/g, '')
      for (const [, raw] of html.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/g)) {
        // Why decode: an entity-encoded `&#45;&#45;` would otherwise hide a loose flag.
        const inner = raw.replace(/&#(x?)([0-9a-f]+);/gi, (_m, hex, n) =>
          String.fromCodePoint(Number.parseInt(n, hex ? 16 : 10))
        )
        flags += (inner.match(/--\w/g) ?? []).length
        const loose = inner.replace(/<span class="nowrap">[^<]*<\/span>/g, '')
        assert.doesNotMatch(loose, /--\w/, `${path.relative(DIST_DIR, file)}: ${inner}`)
      }
    }
    assert.ok(flags >= 20, `only ${flags} flags found in inline code`)
  })
})
