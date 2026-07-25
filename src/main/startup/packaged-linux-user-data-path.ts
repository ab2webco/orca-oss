import { cpSync, existsSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import { getMainE2EConfig } from '../e2e-config'

/** userData directory names a Linux build may have resolved before the path was
 *  pinned: Electron derives it from the app name, which `app.setName('Orca')`
 *  changes at whenReady, and the installer ships `executableName: 'orca-ide'`. */
const LINUX_LEGACY_USER_DATA_DIR_NAMES = ['orca-ide', 'orca', 'com.stablyai.orca'] as const

/** Subdirectories holding data a user cannot lose: Claude/Codex transcripts and
 *  credentials, terminal scrollback, and the persisted app state.
 *
 *  `daemon` carries the live daemon's socket/token/pid. It is deliberately NOT
 *  rescued by copying — see adoptLegacyLinuxDaemonRuntime, which relinks it, since
 *  a copied token would authenticate against a socket path the daemon never bound. */
const RESCUED_USER_DATA_ENTRIES = [
  'claude-accounts',
  'codex-accounts',
  'terminal-history',
  'orca-data.json'
] as const

/**
 * Pin the packaged Linux userData path before anything reads it.
 *
 * Why: Electron derives the Linux (XDG) userData directory from the app name, so
 * `app.setName('Orca')` at whenReady moves it — and the installer's
 * `executableName: 'orca-ide'` differs from the appId, so an update could resolve
 * a different directory than the previous version wrote to. Modules that call
 * `app.getPath('userData')` lazily (Claude transcripts under claude-accounts/,
 * terminal history) then point at an empty directory and the user's conversations
 * look erased. macOS/Windows derive their path from the bundle/app id, which is
 * stable across builds, so they are left untouched.
 *
 * Any data left in a pre-pin directory is migrated forward once, so an install
 * that already lost its transcripts recovers them on the next launch.
 */
export function configurePackagedLinuxUserDataPath(): void {
  if (process.platform !== 'linux' || !app.isPackaged || getMainE2EConfig().userDataDir) {
    return
  }
  // Why `orca-ide`, matching the installer's executableName, rather than a cased
  // variant of the app name: it is the name Electron already derives most often,
  // and it cannot collide with a differently-cased sibling on a case-insensitive
  // filesystem the way `Orca` and `orca` would.
  const pinnedPath = join(app.getPath('appData'), 'orca-ide')
  const previousPath = app.getPath('userData')
  app.setPath('userData', pinnedPath)
  rescueLegacyLinuxUserData(pinnedPath, previousPath)
  adoptLegacyLinuxDaemonRuntime(pinnedPath, previousPath)
}

/**
 * Keep a daemon that outlived the update reachable after the path pin.
 *
 * Why not copy it like the other entries: `daemon/` holds a bound unix socket plus
 * the token and pid that authenticate against it. A live daemon bound
 * `<oldPath>/daemon/daemon-v<N>.sock` and cannot be told to move, so a copied
 * token would point at a socket nobody is listening on. Users hit this as
 * `ENOENT: ... daemon/daemon-v27.token` right after updating, which drops every
 * running agent session.
 *
 * Linking the pinned `daemon/` to the directory the live daemon actually uses lets
 * the new app adopt its own daemon instead of failing to authenticate.
 */
function adoptLegacyLinuxDaemonRuntime(pinnedPath: string, previousPath: string): void {
  const pinnedDaemonPath = join(pinnedPath, 'daemon')
  try {
    // Why: only step in when this install has no daemon state of its own — never
    // redirect a directory the current app already owns.
    if (existsSync(pinnedDaemonPath)) {
      return
    }
    const appDataPath = app.getPath('appData')
    const source = [
      previousPath,
      ...LINUX_LEGACY_USER_DATA_DIR_NAMES.map((name) => join(appDataPath, name))
    ]
      .filter((candidate) => resolve(candidate) !== resolve(pinnedPath))
      .find((candidate) => hasLiveDaemonRuntime(join(candidate, 'daemon')))
    if (!source) {
      return
    }
    mkdirSync(pinnedPath, { recursive: true, mode: 0o700 })
    symlinkSync(join(source, 'daemon'), pinnedDaemonPath, 'dir')
    console.warn(`[userdata] Adopted the pre-pin daemon runtime at ${join(source, 'daemon')}.`)
  } catch (error) {
    // Why: worst case the app spawns a fresh daemon; never block startup for this.
    console.warn('[userdata] Could not adopt a pre-pin daemon runtime:', error)
  }
}

/** True when a directory holds daemon socket/token state a running daemon may own. */
function hasLiveDaemonRuntime(daemonDir: string): boolean {
  try {
    return readdirSync(daemonDir).some((entry) => /^daemon-v\d+\.(?:sock|token)$/.test(entry))
  } catch {
    return false
  }
}

function rescueLegacyLinuxUserData(pinnedPath: string, previousPath: string): void {
  // Why: only adopt legacy data into an install that has none — never overwrite
  // a populated profile with a stale copy.
  const missingEntries = RESCUED_USER_DATA_ENTRIES.filter(
    (entry) => !existsSync(join(pinnedPath, entry))
  )
  if (missingEntries.length === 0) {
    return
  }
  const appDataPath = app.getPath('appData')
  const candidates = [
    previousPath,
    ...LINUX_LEGACY_USER_DATA_DIR_NAMES.map((name) => join(appDataPath, name))
  ].filter((candidate) => resolve(candidate) !== resolve(pinnedPath))

  for (const entry of missingEntries) {
    const source = candidates.find((candidate) => existsSync(join(candidate, entry)))
    if (!source) {
      continue
    }
    try {
      mkdirSync(pinnedPath, { recursive: true, mode: 0o700 })
      cpSync(join(source, entry), join(pinnedPath, entry), {
        recursive: true,
        errorOnExist: false,
        force: false
      })
      console.warn(`[userdata] Recovered ${entry} from a pre-pin Linux profile at ${source}.`)
    } catch (error) {
      // Why: a failed rescue must not block startup — the legacy directory stays
      // on disk, so the next launch can retry.
      console.warn(`[userdata] Could not recover ${entry} from ${source}:`, error)
    }
  }
}
