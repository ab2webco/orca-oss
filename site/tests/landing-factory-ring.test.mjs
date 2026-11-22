import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { SITE_DIR, readBuilt, visibleText } from './support/built-html.mjs'

const source = readFileSync(path.join(SITE_DIR, 'src/components/landing/FactoryRing.astro'), 'utf8')
// The largest text scale the ring is drawn at (viewBox units per screen px) wherever the tag shows.
const K = 1.5

// The browser-level proof is `pnpm shots`; these read the built page.
for (const [file, title, gears] of [
  ['index.html', 'The software factory', ['Panel', 'Sonar', 'Jev', 'Reports', 'Monitors']],
  ['es/index.html', 'La fábrica de software', ['Panel', 'Sonar', 'Jev', 'Reportes', 'Monitores']]
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

    it('rings the lead with the Orca parts and tags the public plugins, Sonar and Jev', () => {
      const names = [
        ...section.matchAll(/class="gear( plugin)?[^"]*"[^>]*>[\s\S]*?<text[^>]*>([^<]+)<\/text>/g)
      ]
      assert.deepEqual(
        names.map((m) => m[2]),
        gears
      )
      assert.deepEqual(
        names.filter((m) => m[1]).map((m) => m[2]),
        ['Sonar', 'Jev']
      )
    })

    it('names only what ships: no example transcript, no unbuilt release checks, no private plugin', () => {
      const text = visibleText(section)
      assert.doesNotMatch(section, /<pre[^>]*>\s*jev:/m)
      assert.doesNotMatch(
        text,
        /what to test|against the old|qué probar|lo que ya existía|WhatsApp/
      )
      // Orca does not make a review mandatory: the lead sends one.
      assert.doesNotMatch(
        text,
        /reviews every change|revisa cada cambio|before it merges|antes de integrarlo/
      )
    })

    it('drops the side sublabels below 45rem, where they would run past the drawing', () => {
      assert.match(source, /@media \(max-width: 44\.99rem\) \{\s*\.lbl \.sub \{\s*display: none;/)
    })

    it('draws the legend review mark at the review station', () => {
      assert.match(section, /<i class="review[ "]/)
      assert.match(
        section,
        /<g class="mark[ "][^>]*data-at="6"[^>]*>\s*<g class="ms[ "][^>]*>(\s*<circle[^>]*><\/circle>){2}/
      )
    })

    it('parks the ticket chip midway between stations, clear of both and inside the phone crop', () => {
      const stations = [...section.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="19"/g)].map(
        (m) => [Number(m[1]), Number(m[2])]
      )
      const chips = [...section.matchAll(/data-chip="([\d.]+) ([\d.]+)"/g)].map((m) => [
        Number(m[1]),
        Number(m[2])
      ])
      assert.equal(stations.length, 10)
      for (const [x, y] of chips) {
        // The phone crop shows x 180..680 and draws the chip as a dot of 12 units there.
        assert.ok(x - 12 >= 180 && x + 12 <= 680, `chip at ${x} leaves the phone crop`)
        for (const [cx, cy] of stations) {
          const dx = Math.max(Math.abs(cx - x) - 30 * K, 0)
          const dy = Math.max(Math.abs(cy - y) - 14 * K, 0)
          assert.ok(Math.hypot(dx, dy) > 21, `chip at ${x} ${y} covers the station at ${cx} ${cy}`)
        }
      }
    })

    it('lays out the stepper before its script runs, so nothing below moves on load', () => {
      assert.match(section, /<div class="picks[^"]*"(?![^>]*hidden)[^>]*data-factory-picks/)
      assert.match(source, /:global\(html:not\(\.no-js\)\) \.caps li \{\s*grid-area: 1 \/ 1;/)
    })

    it('gives the ring the wide column and keeps steps 1-10 on one row with Play apart', () => {
      assert.match(
        source,
        /\.factory \{[^}]*grid-template-columns: minmax\(0, 25rem\) minmax\(0, 1fr\);[^}]*max-width: 1440px/
      )
      assert.match(source, /\.picks \{[^}]*grid-template-columns: repeat\(10, minmax\(0, 48px\)\)/)
      assert.match(source, /\.picks \.toggle \{[^}]*grid-column: 1 \/ -1/)
    })

    it('keeps ring text at screen size however far the drawing scales, and buttons named by their number', () => {
      const sizes = [...source.matchAll(/svg \.[^{]*\{[^}]*font-size: ([^;]+);/g)].map((m) => m[1])
      assert.ok(sizes.length >= 6)
      for (const size of sizes) {
        assert.match(size, /^calc\(var\(--k\) \* (1[4-9]|2\d)px\)$|^14px$/)
      }
      for (const [, n, label] of section.matchAll(/data-pick="(\d+)" aria-label="([^"]*)"/g)) {
        assert.ok(label.startsWith(`${n}. `), label)
      }
    })
  })
}
