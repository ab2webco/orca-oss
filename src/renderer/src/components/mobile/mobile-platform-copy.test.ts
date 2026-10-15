import { describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

import { getInstallCopy, hasIosStableChannel } from './mobile-platform-copy'
import {
  ORCA_MOBILE_ANDROID_APK_URL,
  ORCA_MOBILE_IOS_TESTFLIGHT_URL
} from '../../../../shared/orca-mobile-install-links'

describe('mobile install copy', () => {
  it('sends iOS users to Orca Lab TestFlight', () => {
    expect(getInstallCopy('ios', 'preview')).toEqual({
      ctaLabel: 'Open TestFlight',
      url: ORCA_MOBILE_IOS_TESTFLIGHT_URL
    })
  })

  it('falls back to TestFlight for the stable channel while there is no App Store listing', () => {
    expect(hasIosStableChannel()).toBe(false)
    expect(getInstallCopy('ios', 'stable').url).toBe(ORCA_MOBILE_IOS_TESTFLIGHT_URL)
  })

  it("downloads Orca Lab's APK on Android", () => {
    expect(getInstallCopy('android', 'preview').url).toBe(ORCA_MOBILE_ANDROID_APK_URL)
  })
})
