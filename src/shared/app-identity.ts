/** The product name the user reads — safe to rename. Three things deliberately do
 *  NOT follow it, each pinned somewhere different:
 *   - `appId` (`com.stablyai.orca`) in config/electron-builder.config.cjs
 *   - the safeStorage Keychain item, from KEYCHAIN_APP_NAME in
 *     src/main/startup/dev-instance-identity.ts via `app.setName()` at whenReady
 *   - the userData directory, which Electron derives from the app name on macOS
 *     and Linux — pinned before any reader by
 *     src/main/startup/packaged-{macos,linux}-user-data-path.ts, because
 *     `app.setName()` runs too late to protect it. */
export const APP_DISPLAY_NAME = 'Orca Lab'

export type AppIdentity = {
  /** Display name. In dev this carries the branch, e.g. `Orca Lab: my-branch`. */
  name: string
  isDev: boolean
  devLabel: string | null
  devBranch: string | null
  devWorktreeName: string | null
  devRepoRoot: string | null
  dockBadgeLabel: string | null
}
