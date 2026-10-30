import { spawn as spawnChild, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { statSync } from 'node:fs'
import { SONAR_PLUGIN_KEY, resolveSonarCli } from '../shared/sonar-cli-location'

export const SONAR_WARMUP_TIMEOUT_MS = 30_000

export type SonarWarmupChild = Pick<ChildProcess, 'kill' | 'unref'> & {
  on(event: 'exit' | 'error', listener: (...args: unknown[]) => void): unknown
}

export type SonarWarmupSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => SonarWarmupChild

export type ScheduleSonarIndexWarmupOptions = {
  userDataDir: string
  worktreePath: string
  // Why: the warm-up runs the plugin's code, so it waits for the same enable and consent its worker does.
  isPluginActive: () => boolean
  spawn?: SonarWarmupSpawn
  debug: (message: string, error: unknown) => void
}

/** Starts `orca-sonar index` for a new worktree in the background. Never awaited, never throws. */
export function scheduleSonarIndexWarmup(options: ScheduleSonarIndexWarmupOptions): void {
  const { userDataDir, worktreePath, debug } = options
  try {
    if (!options.isPluginActive() || !isDirectory(worktreePath)) {
      return
    }
    const lookup = resolveSonarCli(userDataDir)
    if (!lookup.ok) {
      return
    }
    const start = options.spawn ?? spawnChild
    // Why: published orca-sonar v0.1.0 rejects unknown flags, so warm-up is signalled by env.
    const child = start('node', [lookup.cliPath, 'index', '--root', worktreePath], {
      env: { ...process.env, ORCA_USER_DATA_PATH: userDataDir, ORCA_SONAR_WARMUP: '1' },
      stdio: 'ignore'
    })
    const timer = setTimeout(() => child.kill(), SONAR_WARMUP_TIMEOUT_MS)
    child.on('exit', () => clearTimeout(timer))
    child.on('error', (error: unknown) => {
      clearTimeout(timer)
      debug('orca-sonar warm-up failed', error)
    })
    child.unref()
  } catch (error) {
    debug('orca-sonar warm-up could not start', error)
  }
}

/** Null grants mean disabled, unconsented, kill-listed or the plugin system off. */
export function isSonarPluginActive(
  plugins: { getGrantedCapabilities: (pluginKey: string) => readonly unknown[] | null } | null
): boolean {
  return plugins?.getGrantedCapabilities(SONAR_PLUGIN_KEY) != null
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
