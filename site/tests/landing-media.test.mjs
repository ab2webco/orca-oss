import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { CLIPS, RECORDINGS } from '../src/data/recordings.mjs'
import { readBuilt, REPO_DIR } from './support/built-html.mjs'

// The owner's rule for the landing: no invented images, only recordings of what was built.
for (const file of ['index.html', 'es/index.html']) {
  describe(`landing media (${file})`, () => {
    const html = readBuilt(file)
    const images = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1])

    it('shows only the icon and recordings from docs/assets/readme', () => {
      const unknown = images.filter(
        (src) => !src.endsWith('/icon.png') && !/\/media\/readme\/[\w-]+\.gif$/.test(src)
      )
      assert.deepEqual(unknown, [])
    })

    it('lists every recording it shows in recordings.mjs, and each exists', () => {
      for (const src of images.filter((one) => one.includes('/media/readme/'))) {
        const name = path.basename(src)
        assert.ok(RECORDINGS[name], `${name} is not in recordings.mjs`)
        assert.ok(existsSync(path.join(REPO_DIR, 'docs/assets/readme', name)), name)
      }
    })

    it('opens on the Office clip, and plays only clips listed in recordings.mjs that exist', () => {
      const clips = [
        ...html.matchAll(/<source\b[^>]*\bsrc="[^"]*\/media\/clips\/([\w-]+)\.(webm|mp4)"/g)
      ]
      assert.equal(clips[0]?.[1], 'team-office-building')
      for (const [, name, ext] of clips) {
        assert.ok(CLIPS.includes(name), `${name} is not in CLIPS`)
        assert.ok(existsSync(path.join(REPO_DIR, 'docs/assets/media', `${name}.${ext}`)), name)
      }
    })
  })
}
