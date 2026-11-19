import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readBuilt } from './support/built-html.mjs'

// The browser-level proof is `pnpm shots landing` (the hero must end inside 1440x900); site-check has
// no browser, so these read the built page.
for (const file of ['index.html', 'es/index.html']) {
  describe(`landing hero (${file})`, () => {
    const html = readBuilt(file)
    const css = [
      ...html.matchAll(/<link rel="stylesheet" href="\/orca-oss\/(_astro\/[\w.-]+\.css)"/g)
    ]
      .map((m) => readBuilt(m[1]))
      .join('\n')
    const scope = /<section class="hero (astro-\w+)"/.exec(html)?.[1]

    it('keeps the title out of the copy column, so it can span the clip too', () => {
      const hero = /<section class="hero[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
      assert.ok(hero, 'no hero section in the built page')
      assert.ok(
        hero.indexOf('id="hero-title"') < hero.indexOf('class="copy'),
        'the title is inside the copy'
      )
    })

    it('sets the clip beside the copy from 60rem, so the hero fits the first screen', () => {
      assert.ok(scope, 'no scoped hero section')
      const wide = new RegExp(
        `@media \\((?:width\\s*>=\\s*|min-width:\\s*)60rem\\)\\s*\\{[^@]*\\.grid:where\\(\\.${scope}\\)\\{grid-template-columns:minmax\\(0,\\d+fr\\) minmax\\(0,\\d+fr\\)\\}`
      )
      assert.match(css, wide)
    })
  })
}
