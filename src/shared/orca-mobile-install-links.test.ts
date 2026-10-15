import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ORCA_MOBILE_ANDROID_APK_URL,
  ORCA_MOBILE_ANDROID_VERSION,
  ORCA_MOBILE_IOS_APP_STORE_URL,
  ORCA_MOBILE_IOS_TESTFLIGHT_URL
} from './orca-mobile-install-links'
import { ORCA_REPOSITORY_URL } from './orca-repository-url'

const UPSTREAM_MARKERS = ['stablyai/orca', 'id6766130217', 'YjeGMQBA']

describe('Orca Lab mobile install links', () => {
  it("downloads the Android APK from Orca Lab's own releases", () => {
    expect(ORCA_MOBILE_ANDROID_APK_URL).toBe(
      `${ORCA_REPOSITORY_URL}/releases/download/mobile-android-v${ORCA_MOBILE_ANDROID_VERSION}/app-release.apk`
    )
  })

  it("joins Orca Lab's own TestFlight beta on iOS", () => {
    expect(ORCA_MOBILE_IOS_TESTFLIGHT_URL).toBe('https://testflight.apple.com/join/xbePNDGj')
  })

  // Why: Orca Lab has no App Store listing yet; a link here would install upstream's app.
  it('has no App Store listing to send anyone to yet', () => {
    expect(ORCA_MOBILE_IOS_APP_STORE_URL).toBeNull()
  })

  // Why: a pin that trails the app ships a stale APK; the release PR bumps both.
  it('pins the APK to the version mobile/app.json releases', () => {
    const appJson = JSON.parse(readFileSync(resolve(__dirname, '../../mobile/app.json'), 'utf8'))
    expect(ORCA_MOBILE_ANDROID_VERSION).toBe(appJson.expo.version)
  })

  it.each([
    'src/renderer/src/components/mobile/mobile-platform-copy.ts',
    'src/renderer/src/components/settings/MobileSettingsPane.tsx',
    'mobile/src/components/ProtocolBlockScreen.tsx'
  ])('%s sends no one to upstream builds', (file) => {
    const source = readFileSync(resolve(__dirname, '../..', file), 'utf8')
    for (const marker of UPSTREAM_MARKERS) {
      expect(source).not.toContain(marker)
    }
  })
})
