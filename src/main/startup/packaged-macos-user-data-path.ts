import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import { getMainE2EConfig } from '../e2e-config'

/** The Application Support directory every shipped macOS build has written to.
 *  A literal, not a derived value: that is the whole point — see below. */
const PINNED_USER_DATA_DIR_NAME = 'Orca'

/** Subdirectories holding data a user cannot lose. Mirrors the Linux pin. */
const RESCUED_USER_DATA_ENTRIES = [
  'claude-accounts',
  'codex-accounts',
  'terminal-history',
  'orca-data.json'
] as const

/**
 * Pin the packaged macOS userData path before anything reads it.
 *
 * Why: Electron derives the macOS userData directory from `app.getName()`, which
 * on a packaged build is `CFBundleName` — and electron-builder writes
 * `productName` into `CFBundleName`. So renaming productName to `Orca Lab` moves
 * ~/Library/Application Support/Orca to .../Orca Lab, and every lazy
 * `app.getPath('userData')` reader (Claude/Codex transcripts, terminal history,
 * the persisted app state) lands in an empty directory. The safeStorage Keychain
 * item follows the same name.
 *
 * `app.setName()` at whenReady cannot prevent this: it runs after Electron has
 * already resolved the path, and initDataPath()/getCanonicalUserDataPath()
 * deliberately capture userData before it.
 *
 * Linux has the same problem for its own reason and its own pin; Windows derives
 * its path from the app id, which productName does not touch.
 */
export function configurePackagedMacosUserDataPath(): void {
  if (process.platform !== 'darwin' || !app.isPackaged || getMainE2EConfig().userDataDir) {
    return
  }
  const pinnedPath = join(app.getPath('appData'), PINNED_USER_DATA_DIR_NAME)
  const previousPath = app.getPath('userData')
  app.setPath('userData', pinnedPath)
  rescueRenamedProfile(pinnedPath, previousPath)
}

/**
 * Adopt data a build that ran before this pin wrote under the renamed directory.
 *
 * Only ever copies into an install that has none of its own — never overwrites a
 * populated profile with a stale copy.
 */
function rescueRenamedProfile(pinnedPath: string, previousPath: string): void {
  if (resolve(previousPath) === resolve(pinnedPath)) {
    return
  }
  const missingEntries = RESCUED_USER_DATA_ENTRIES.filter(
    (entry) => !existsSync(join(pinnedPath, entry))
  )
  for (const entry of missingEntries) {
    const source = join(previousPath, entry)
    if (!existsSync(source)) {
      continue
    }
    try {
      mkdirSync(pinnedPath, { recursive: true, mode: 0o700 })
      cpSync(source, join(pinnedPath, entry), {
        recursive: true,
        errorOnExist: false,
        force: false
      })
      console.warn(`[userdata] Recovered ${entry} from a renamed macOS profile at ${previousPath}.`)
    } catch (error) {
      // Why: a failed rescue must not block startup — the directory stays on
      // disk, so the next launch can retry.
      console.warn(`[userdata] Could not recover ${entry} from ${previousPath}:`, error)
    }
  }
}
