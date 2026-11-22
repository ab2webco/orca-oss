import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')

// Why (ORCA-1298): Electron 43 always has decryptStringAsync, so every profile loads its protected
// secrets sealed; this one call is all that unseals them, and the store suites cannot see index.ts.
describe('startup unseals protected secrets', () => {
  it('awaits the unseal right after the store is built, before anything reads its settings', () => {
    const built = source.indexOf('store = new Store(')
    const unsealed = source.indexOf('await store.unsealProtectedSecrets(', built)
    const firstSettingsRead = source.indexOf('store.getSettings()', built)

    expect(built).toBeGreaterThanOrEqual(0)
    expect(unsealed).toBeGreaterThan(built)
    expect(unsealed).toBeLessThan(firstSettingsRead)
  })

  it('re-applies the network proxy when a late Keychain answer unseals it', () => {
    const unsealed = source.indexOf('await store.unsealProtectedSecrets(')
    const callback = source.slice(unsealed, source.indexOf('})', unsealed))

    expect(callback).toContain('applyElectronProxySettings(settings)')
  })
})
