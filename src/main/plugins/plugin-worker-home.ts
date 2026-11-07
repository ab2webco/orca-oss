import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { startPluginWorker } from './plugin-host-process'
import type { PluginWorkerFactory } from './plugin-worker-startup'

/**
 * Why: a plugin that installs Claude hooks writes `~/.claude/settings.json` with paths into
 * this instance's plugin folder, and vault creation clones that file into every account. A dev
 * Orca doing so leaves every Claude session on the machine pointing at a profile that is
 * deleted later (ORCA-1113), so its workers get a home inside the profile it owns.
 * E2E already runs the whole app under a disposable home.
 */
export function resolvePluginWorkerHome(options: {
  isPackaged: boolean
  isE2E: boolean
  userDataPath: string
}): string | null {
  if (options.isPackaged || options.isE2E) {
    return null
  }
  return join(options.userDataPath, 'plugin-home')
}

export function createPluginWorkerFactory(homeDir: string | null): PluginWorkerFactory | undefined {
  if (homeDir === null) {
    return undefined
  }
  return (options) => {
    mkdirSync(homeDir, { recursive: true, mode: 0o700 })
    return startPluginWorker({ ...options, homeDir })
  }
}
