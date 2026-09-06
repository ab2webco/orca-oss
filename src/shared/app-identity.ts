/** The product name the user reads. Not the identity: `appId` and the safeStorage
 *  Keychain name stay `Orca`, pinned by the unconditional `app.setName()` in
 *  src/main/index.ts (whenReady) from KEYCHAIN_APP_NAME in
 *  src/main/startup/dev-instance-identity.ts. */
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
