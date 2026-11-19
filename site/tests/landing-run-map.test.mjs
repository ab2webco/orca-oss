import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readBuilt } from './support/built-html.mjs'

// The browser-level proof is `pnpm motion`; site-check has no browser, so these read the built page.
for (const file of ['index.html', 'es/index.html']) {
  describe(`landing run map (${file})`, () => {
    const html = readBuilt(file)
    const css = [
      ...html.matchAll(/<link rel="stylesheet" href="\/orca-oss\/(_astro\/[\w.-]+\.css)"/g)
    ]
      .map((m) => readBuilt(m[1]))
      .join('\n')
    const script = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)]
      .map((m) => m[1])
      .find((one) => one.includes('[data-run-controls]'))

    it('marks the map while it shows one caption at a time', () => {
      assert.ok(script, 'no run map script in the built page')
      assert.match(script, /toggleAttribute\([`'"]data-stepper[`'"]/)
    })

    it('stacks the stepper captions in one cell, so a step never changes the height', () => {
      const rules = [...css.matchAll(/([^{}]*\[data-stepper\][^{}]*)\{([^}]*)\}/g)]
      const stacked = rules.find(
        ([, selector, body]) => /\bli\b/.test(selector) && /grid-area:1\s*\/\s*1/.test(body)
      )
      const kept = rules.find(
        ([, selector, body]) =>
          /\[hidden\]/.test(selector) &&
          /display:block/.test(body) &&
          /visibility:hidden/.test(body)
      )
      assert.ok(stacked, 'no stepper rule puts every caption in one grid cell')
      assert.ok(kept, 'no stepper rule keeps a hidden caption in the layout')
    })

    it('keeps the captions quiet for screen readers while the map advances by itself', () => {
      assert.match(
        script,
        /setAttribute\([`'"]aria-live[`'"],\s*\w+\s*\?\s*[`'"]off[`'"]\s*:\s*[`'"]polite[`'"]\)/
      )
    })
  })
}
