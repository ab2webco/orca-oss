import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const BUNDLE_ID = 'com.ab2web.orca.mobile'

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8')
}

const appConfig = JSON.parse(read('app.json')) as {
  expo: { ios: { bundleIdentifier: string }; android: { package: string } }
}

function declaredIdentifier(relativePath: string, pattern: RegExp): string {
  const match = read(relativePath).match(pattern)
  expect(match, `no identifier found in ${relativePath}`).not.toBeNull()
  return match![1]
}

// Why its own file: the store identifier is permanent from the first upload and
// Android's is public in the listing URL, so a silent revert is unrecoverable —
// and it fails at the store, not in a build.
describe('mobile store release identity', () => {
  it('publishes iOS and Android under the fork identifier', () => {
    expect(appConfig.expo.ios.bundleIdentifier).toBe(BUNDLE_ID)
    expect(appConfig.expo.android.package).toBe(BUNDLE_ID)
  })

  // Why fastlane is checked separately: it carries its own copies, so a partial
  // revert would sign and upload under an identifier app.json never names.
  it('signs and uploads under that same identifier', () => {
    expect(declaredIdentifier('fastlane/Fastfile', /BUNDLE_ID\s*=\s*"([^"]+)"/)).toBe(BUNDLE_ID)
    expect(declaredIdentifier('fastlane/Appfile', /app_identifier\([^)]*?"([^"]+)"\s*\)/)).toBe(
      BUNDLE_ID
    )
  })

  // Why upstream is named explicitly: an upstream sync re-adds it in files that
  // merge clean, where no conflict forces a decision.
  it('never carries upstream identifier back in', () => {
    for (const path of ['app.json', 'fastlane/Fastfile', 'fastlane/Appfile']) {
      expect(read(path), path).not.toContain('com.stably.orca')
    }
  })
})
