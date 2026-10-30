import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Why: the plugin's install folder name is its identity (`<publisher>.<id>`).
export const SONAR_PLUGIN_KEY = 'ab2web.orca-sonar'
const CURRENT_POINTER = 'current'
const CONTENT_HASH = /^[0-9a-f]{64}$/
const CLI_ENTRY = join('bin', 'orca-sonar.ts')

export type SonarCliLookup =
  | { ok: true; cliPath: string }
  | {
      ok: false
      reason: 'not_installed' | 'invalid_pointer' | 'missing_entry'
    }

/** The installed orca-sonar CLI, found through Orca's own `current` pointer. */
export function resolveSonarCli(userDataDir: string): SonarCliLookup {
  const pluginDir = join(userDataDir, 'plugins', SONAR_PLUGIN_KEY)
  const pointer = readPointer(join(pluginDir, CURRENT_POINTER))
  if (pointer === null) {
    return { ok: false, reason: 'not_installed' }
  }
  // Why: the pointer picks a folder under the plugin; anything but a hash could escape it.
  if (!CONTENT_HASH.test(pointer)) {
    return { ok: false, reason: 'invalid_pointer' }
  }
  const cliPath = join(pluginDir, pointer, CLI_ENTRY)
  if (!existsSync(cliPath)) {
    return { ok: false, reason: 'missing_entry' }
  }
  return { ok: true, cliPath }
}

function readPointer(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}
