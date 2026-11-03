import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { BASE } from '../site.config.mjs'
import { DIST_DIR, listBuiltFiles } from './support/built-html.mjs'

const ATTR = /\s(?:href|src|srcset|poster|data-src)\s*=\s*("([^"]*)"|'([^']*)')/gi
const SKIP = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i

function pageUrl(file) {
  const rel = path.relative(DIST_DIR, file).split(path.sep).join('/')
  return `${BASE}/${rel.replace(/index\.html$/, '')}`
}

function urlsIn(html) {
  const urls = []
  for (const match of html.matchAll(ATTR)) {
    const value = match[2] ?? match[3] ?? ''
    const isSrcset = /srcset/i.test(match[0])
    const parts = isSrcset ? value.split(',').map((s) => s.trim().split(/\s+/)[0]) : [value]
    urls.push(...parts.filter(Boolean))
  }
  return urls
}

function resolvesInDist(urlPath) {
  const rel = decodeURIComponent(urlPath.slice(BASE.length + 1))
  const target = path.join(DIST_DIR, rel)
  if (urlPath.endsWith('/')) {
    return existsSync(path.join(target, 'index.html'))
  }
  return existsSync(target) || existsSync(path.join(target, 'index.html'))
}

describe('internal links in the built site', () => {
  const pages = listBuiltFiles().filter((file) => file.endsWith('.html'))

  it('built some pages', () => {
    assert.equal(pages.length > 20, true)
  })

  it('every href/src stays under the base and resolves to a built file', () => {
    const broken = []
    for (const file of pages) {
      const from = pageUrl(file)
      for (const raw of urlsIn(readFileSync(file, 'utf8'))) {
        if (SKIP.test(raw)) {
          continue
        }
        const resolved = new URL(raw, `https://site.invalid${from}`).pathname
        if (!resolved.startsWith(`${BASE}/`) && resolved !== BASE) {
          broken.push(`${from} → ${raw} (outside ${BASE}/)`)
        } else if (!raw.startsWith('/')) {
          broken.push(`${from} → ${raw} (relative; use BASE_URL)`)
        } else if (!resolvesInDist(resolved)) {
          broken.push(`${from} → ${raw} (no such file)`)
        }
      }
    }
    assert.deepEqual(broken, [])
  })
})
