import { translateMain } from '../i18n/main-i18n'
import { parseClaudeOauthBlob, readRefreshToken } from './oauth-refresh'

// Why: once per run, like the refresh-chain alias warning — the usage poll
// re-observes the same broken slot every cycle and must not re-prompt.
let warnedUnusableSlot = false

/**
 * Whether a machine-wide `Claude Code-credentials` blob can no longer
 * authenticate anything: it parses, holds no usable refresh token (missing,
 * empty, or blank — the measured breakage is a present-but-empty value), and
 * its access token is absent or already past its recorded expiry. A blob with
 * an access token but no expiry is left alone: not provably dead.
 */
export function isClaudeLegacyKeychainBlobUnusable(
  credentialsJson: string,
  now: number = Date.now()
): boolean {
  const oauth = parseClaudeOauthBlob(credentialsJson)
  if (!oauth || readRefreshToken(credentialsJson) !== null) {
    return false
  }
  const accessToken = oauth.accessToken
  if (typeof accessToken !== 'string' || accessToken.trim() === '') {
    return true
  }
  const expiresAt = oauth.expiresAt
  return typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt <= now
}

/**
 * Record an observation of the machine-wide (unsuffixed) keychain slot's blob.
 * When the blob is unusable, tell the user the truth once: their managed
 * accounts are fine, and one `/login` from a plain `claude` restores the slot.
 * Detection and guidance only — Orca never writes credentials into this slot
 * on a managed account's behalf (the cross-identity write removed in a5dd8e8c5).
 */
export function noteLegacyClaudeKeychainSlotBlob(
  credentialsJson: string,
  now: number = Date.now()
): void {
  if (process.platform !== 'darwin' || warnedUnusableSlot) {
    return
  }
  if (!isClaudeLegacyKeychainBlobUnusable(credentialsJson, now)) {
    return
  }
  warnedUnusableSlot = true
  console.warn(
    '[claude-legacy-keychain] The machine-wide Claude Code-credentials item cannot refresh (no usable refresh token). Managed accounts are unaffected; one /login from a plain `claude` outside Orca restores it.'
  )
  void showUnusableSlotDialog()
}

async function showUnusableSlotDialog(): Promise<void> {
  try {
    const { dialog } = await import('electron')
    await dialog.showMessageBox({
      type: 'warning',
      title: translateMain('claudeAuth.legacySlotUnusable.title', 'Claude login needs repair'),
      message: translateMain(
        'claudeAuth.legacySlotUnusable.message',
        'The system-wide Claude Code login is no longer usable.'
      ),
      detail: translateMain(
        'claudeAuth.legacySlotUnusable.detail',
        'Your Orca-managed Claude accounts are unaffected. To restore the system-wide login, run claude outside Orca and complete /login once.'
      )
    })
  } catch {
    // Headless runtimes keep the diagnostic warning.
  }
}

export function resetLegacyClaudeKeychainSlotWarningForTests(): void {
  warnedUnusableSlot = false
}
