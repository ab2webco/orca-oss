import { describe, expect, it } from 'vitest'

import { repairCatalog } from './locale-translation-policy.mjs'

// Regression: en.json routinely carries keys a locale catalog has not been bootstrapped with yet
// (~190 per locale at the time of writing), which crashed the whole repair run before it did any work.
describe('repairCatalog with un-bootstrapped keys', () => {
  const enCatalog = {
    auto: {
      lib: { agent: { catalog: { '760bc6883d': 'Codex' } } },
      components: { untranslated: 'Continue', nested: { alsoMissing: 'Refresh' } }
    }
  }

  const translatedOnly = () => ({
    auto: { lib: { agent: { catalog: { '760bc6883d': 'Códice' } } } }
  })

  it('skips leaves the locale catalog is missing instead of throwing', () => {
    const localeCatalog = translatedOnly()
    expect(() => repairCatalog(enCatalog, localeCatalog, 'es')).not.toThrow()
    expect(localeCatalog.auto.components).toBeUndefined()
  })

  it('still repairs the leaves that are present', () => {
    const localeCatalog = translatedOnly()
    expect(repairCatalog(enCatalog, localeCatalog, 'es')).toBe(1)
    expect(localeCatalog.auto.lib.agent.catalog['760bc6883d']).toBe('Codex')
  })
})
