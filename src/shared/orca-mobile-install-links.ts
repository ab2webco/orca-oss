// Why: install and update links for the phone app must lead to Orca Lab's own
// builds; upstream's listings install upstream's app instead.
import { ORCA_REPOSITORY_URL } from './orca-repository-url'

/** Kept equal to mobile/app.json's version; the mobile release PR bumps both. */
export const ORCA_MOBILE_ANDROID_VERSION = '0.0.58'

export const ORCA_MOBILE_ANDROID_APK_URL = `${ORCA_REPOSITORY_URL}/releases/download/mobile-android-v${ORCA_MOBILE_ANDROID_VERSION}/app-release.apk`

/** Public link to the external TestFlight group; TestFlight keeps testers updated. */
export const ORCA_MOBILE_IOS_TESTFLIGHT_URL = 'https://testflight.apple.com/join/xbePNDGj'

/** Null until Orca Lab has its own App Store listing; the Stable channel stays hidden. */
export const ORCA_MOBILE_IOS_APP_STORE_URL: string | null = null
