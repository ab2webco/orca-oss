import { readClaudeManagedAuthFile, writeClaudeManagedAuthFile } from './managed-auth-path'

/** The flag Claude Code checks before running its first-run wizard. */
const ONBOARDING_FLAG = 'hasCompletedOnboarding'

/**
 * Marks a managed vault as past Claude Code's first-run wizard.
 *
 * Why: `CLAUDE_CONFIG_DIR` points a launch at the vault, and Claude Code reads
 * `.claude.json` from there. A fresh vault has no `hasCompletedOnboarding`, so
 * an interactive launch opens the wizard — theme, then "Select login method" —
 * even though the vault already holds valid OAuth credentials. On the desktop
 * the user can click through it once per account; on a headless `orca serve`
 * the wizard IS the wall, and every terminal on the server looked logged out.
 *
 * Why here and not at vault creation: this runs where the vault first receives
 * a real identity, so the claim it encodes — onboarding happened, in Orca's own
 * account flow — is true by construction at the moment it is written.
 *
 * Only ever fills the gap: an existing flag, of any value, is the CLI's own
 * state and is left alone.
 */
export function seedVaultOnboardingCompletion(managedAuthPath: string): void {
  const existing = readClaudeManagedAuthFile(managedAuthPath, '.claude.json')
  let config: Record<string, unknown> = {}
  if (existing !== null) {
    try {
      const parsed: unknown = JSON.parse(existing)
      // Why the shape guard: a corrupt or non-object file must not be replaced
      // with our two keys — that would drop whatever the CLI had stored.
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return
      }
      config = parsed as Record<string, unknown>
    } catch {
      return
    }
    if (ONBOARDING_FLAG in config) {
      return
    }
  }
  config[ONBOARDING_FLAG] = true
  writeClaudeManagedAuthFile(
    managedAuthPath,
    '.claude.json',
    `${JSON.stringify(config, null, 2)}\n`
  )
}
