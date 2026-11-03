import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readBuilt, visibleText } from './support/built-html.mjs'
import { loadProductFacts, NOT_ADVERTISED, PLATFORMS } from './support/product-facts.mjs'

const facts = await loadProductFacts()

for (const [locale, file] of [
  ['en', 'index.html'],
  ['es', 'es/index.html']
]) {
  describe(`landing (${locale})`, () => {
    const text = visibleText(readBuilt(file))
    const missing = (names) => names.filter((name) => !text.includes(name))

    it('names every task provider in src/shared/task-providers.ts', () => {
      assert.deepEqual(missing(facts.taskProviders), [])
    })

    it('names every review provider in Settings → Integrations', () => {
      assert.equal(facts.prProviders.length >= 5, true)
      assert.deepEqual(missing(facts.prProviders), [])
    })

    it('names every agent in TUI_AGENT_DISPLAY_NAMES', () => {
      assert.equal(facts.agents.length >= 30, true)
      assert.deepEqual(missing(facts.agents), [])
    })

    it('names the desktop and mobile platforms', () => {
      assert.deepEqual(missing(PLATFORMS), [])
    })

    it('puts the orchestrator and experimental features on the page', () => {
      assert.deepEqual(missing(['Orca Game', 'XP', '--on']), [])
      assert.match(text, locale === 'es' ? /Experimental/ : /Experimental/)
    })

    it('does not advertise unmerged or unverified features', () => {
      assert.deepEqual(NOT_ADVERTISED.filter((pattern) => pattern.test(text)).map(String), [])
    })
  })
}
