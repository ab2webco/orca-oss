import type * as LocalAuthentication from 'expo-local-authentication'

export type DeviceAuthenticator = Pick<typeof LocalAuthentication, 'authenticateAsync'>

export type InstallConfirmation =
  | { ok: true }
  | { ok: false; reason: 'cancelled' | 'no-device-lock' | 'failed' }

const CANCEL_ERRORS = new Set(['user_cancel', 'system_cancel', 'app_cancel', 'user_fallback'])
const NO_LOCK_ERRORS = new Set(['passcode_not_set', 'not_enrolled', 'not_available'])

/** Owner's control 3: a restart request needs the phone's owner, not just an unlocked app. */
export async function confirmRemoteUpdateInstall(
  auth: DeviceAuthenticator
): Promise<InstallConfirmation> {
  try {
    const result = await auth.authenticateAsync({
      promptMessage: 'Install the desktop update',
      disableDeviceFallback: false
    })
    if (result.success) {
      return { ok: true }
    }
    if (CANCEL_ERRORS.has(result.error)) {
      return { ok: false, reason: 'cancelled' }
    }
    // Why: fail closed — a phone without a lock cannot prove its owner asked.
    return { ok: false, reason: NO_LOCK_ERRORS.has(result.error) ? 'no-device-lock' : 'failed' }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}
