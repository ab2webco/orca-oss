import type { Platform } from './MobileHero'
import { translate } from '@/i18n/i18n'
import {
  ORCA_MOBILE_ANDROID_APK_URL,
  ORCA_MOBILE_IOS_APP_STORE_URL,
  ORCA_MOBILE_IOS_TESTFLIGHT_URL
} from '../../../../shared/orca-mobile-install-links'

// iOS has a TestFlight preview track and, once listed, an App Store stable track.
// Android only ships one APK track.
export type IosChannel = 'stable' | 'preview'

export type InstallCopy = { ctaLabel: string; url: string }

const IOS_TESTFLIGHT_COPY: InstallCopy = {
  ctaLabel: 'Open TestFlight',
  url: ORCA_MOBILE_IOS_TESTFLIGHT_URL
}

// Why: without an App Store listing the stable channel would install upstream's
// app, so it falls back to TestFlight and the channel picker stays hidden.
const IOS_CHANNEL_COPY: Record<IosChannel, InstallCopy> = {
  stable: ORCA_MOBILE_IOS_APP_STORE_URL
    ? { ctaLabel: 'Open App Store', url: ORCA_MOBILE_IOS_APP_STORE_URL }
    : IOS_TESTFLIGHT_COPY,
  preview: IOS_TESTFLIGHT_COPY
}

export function hasIosStableChannel(): boolean {
  return ORCA_MOBILE_IOS_APP_STORE_URL !== null
}

const ANDROID_COPY: InstallCopy = {
  ctaLabel: 'Download APK',
  url: ORCA_MOBILE_ANDROID_APK_URL
}

export function getInstallCopy(platform: Platform, iosChannel: IosChannel): InstallCopy {
  return platform === 'ios' ? IOS_CHANNEL_COPY[iosChannel] : ANDROID_COPY
}

export function getChannelTagline(iosChannel: IosChannel): string {
  return iosChannel === 'preview'
    ? translate(
        'auto.components.mobile.mobile.platform.copy.preview.tagline',
        'Newest features, updated daily.'
      )
    : translate(
        'auto.components.mobile.mobile.platform.copy.stable.tagline',
        'The public release, updated weekly.'
      )
}
