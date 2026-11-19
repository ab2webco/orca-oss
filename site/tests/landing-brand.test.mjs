import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { readBuilt, REPO_DIR } from './support/built-html.mjs'

// The header and the footer draw the app's own logo, in the text colour, not a stand-in glyph.
const logo = readFileSync(path.join(REPO_DIR, 'resources/logo.svg'), 'utf8')
const firstPath = /<path\b[^>]*\bd="([^"]+)"/.exec(logo)[1]

for (const file of ['index.html', 'es/index.html']) {
  describe(`landing brand (${file})`, () => {
    const html = readBuilt(file)
    const marks = [...html.matchAll(/<svg class="mark[^"]*"[^>]*>([\s\S]*?)<\/svg>/g)]

    it('draws the logo in the header and the footer', () => {
      assert.equal(marks.length, 2)
      for (const [, body] of marks) {
        assert.ok(body.includes(firstPath), 'the mark is resources/logo.svg')
        assert.doesNotMatch(body, /fill="#/, 'the mark takes the text colour')
      }
    })
  })
}
