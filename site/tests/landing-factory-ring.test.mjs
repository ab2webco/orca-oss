import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readBuilt, visibleText } from './support/built-html.mjs'

// The browser-level proof is `pnpm shots`; these read the built page.
for (const [file, title, gears] of [
  [
    'index.html',
    'The software factory',
    ['Panel', 'Sonar', 'Jev', 'Reports', 'WhatsApp', 'Monitors']
  ],
  [
    'es/index.html',
    'La fábrica de software',
    ['Panel', 'Sonar', 'Jev', 'Reportes', 'WhatsApp', 'Monitores']
  ]
]) {
  describe(`landing factory ring (${String(file)})`, () => {
    const html = readBuilt(file)
    const section = html.match(/<section[^>]*id="factory"[\s\S]*?<\/section>/)?.[0] ?? ''

    it('puts the factory section on the page under its title', () => {
      assert.ok(section, 'no factory section in the built page')
      assert.ok(visibleText(section).includes(title))
    })

    it('draws ten stations, ten track hops and one caption with a ticket stop per station', () => {
      assert.equal(section.match(/class="st [a-z]+[^"]*" data-at="\d+"/g)?.length, 10)
      assert.equal(section.match(/data-hop="\d+"/g)?.length, 10)
      assert.equal(section.match(/data-step="\d+" data-chip="[\d.]+ [\d.]+"/g)?.length, 10)
    })

    it('rings the lead with the Orca parts and tags Sonar, Jev and WhatsApp as plugins', () => {
      const names = [
        ...section.matchAll(/class="gear( plugin)?[^"]*"[^>]*>[\s\S]*?<text[^>]*>([^<]+)<\/text>/g)
      ]
      assert.deepEqual(
        names.map((m) => m[2]),
        gears
      )
      assert.deepEqual(
        names.filter((m) => m[1]).map((m) => m[2]),
        ['Sonar', 'Jev', 'WhatsApp']
      )
    })
  })
}
