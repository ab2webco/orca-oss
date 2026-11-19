import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readBuilt } from './support/built-html.mjs'

// A wrapped command must not break inside a word: `--` on one line and `ticket` on the next.
for (const file of ['index.html', 'es/index.html']) {
  describe(`landing commands (${file})`, () => {
    const blocks = [...readBuilt(file).matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/g)].map((m) => m[1])

    it('keeps every flag in one unbreakable word', () => {
      assert.ok(blocks.length >= 3)
      for (const block of blocks) {
        const loose = block.replace(/<span class="(nowrap|c)">[^<]*<\/span>/g, '')
        assert.doesNotMatch(loose, /--\w/, block)
      }
    })
  })
}
