import { posix, win32 } from 'node:path'

/**
 * Scrubbed environment for plugin workers. Deliberately an allowlist — the
 * app's own environment can carry secrets (tokens exported in the user's
 * shell, CI credentials); plugins must not inherit it. This intentionally
 * diverges from the sidecar precedent, which spreads the full process.env.
 */

const WORKER_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TMPDIR',
  'TEMP',
  'TMP',
  // Why: a worker that shells out to the CLI must land on the userData directory
  // this app wrote its runtime metadata to; without these it resolves its own and
  // talks to a retired install (ORCA-516). Both are paths Orca already publishes.
  'ORCA_USER_DATA_PATH',
  'XDG_CONFIG_HOME',
  // Why: Windows Node/libuv need these to resolve DLLs and the machine root.
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS'
] as const

/** @param homeDir replaces the user's home (see plugin-worker-home.ts); null keeps it. */
export function buildPluginWorkerEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir: string | null = null
): Record<string, string> {
  const env: Record<string, string> = {}
  const windowsLookup = new Map<string, string>()
  if (platform === 'win32') {
    // Why: Windows environment keys are case-insensitive, while POSIX keys
    // are not; folding on every platform could promote an attacker-set `path`.
    for (const [key, value] of Object.entries(baseEnv)) {
      if (typeof value === 'string') {
        windowsLookup.set(key.toUpperCase(), value)
      }
    }
  }
  for (const key of WORKER_ENV_ALLOWLIST) {
    const value = platform === 'win32' ? windowsLookup.get(key) : baseEnv[key]
    if (value !== undefined) {
      env[key === 'SYSTEMROOT' ? 'SystemRoot' : key] = value
    }
  }
  if (homeDir !== null) {
    // Why all three: os.homedir() reads USERPROFILE on Windows and HOME elsewhere, and
    // Linux config dirs follow XDG_CONFIG_HOME before falling back to ~/.config.
    env.HOME = homeDir
    env.XDG_CONFIG_HOME = (platform === 'win32' ? win32 : posix).join(homeDir, '.config')
    if (platform === 'win32') {
      env.USERPROFILE = homeDir
    }
  }
  env.ELECTRON_RUN_AS_NODE = '1'
  return env
}
