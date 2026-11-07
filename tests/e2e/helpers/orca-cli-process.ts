import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import path from 'node:path'

export const ORCA_CLI_ENTRY = path.join(process.cwd(), 'out', 'cli', 'index.js')

/**
 * The runner's env without the ORCA_* an Orca pane exports, keeping the harness's ORCA_E2E_*.
 * Why (ORCA-1118): run from a member pane, ORCA_GAME_ROLE=member made `game.state` answer as a member.
 */
function orcaCliBaseEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('ORCA_') || name.startsWith('ORCA_E2E_')
    )
  )
}

/** Runs the built CLI against one E2E profile, with only the pane env the spec names. */
export function runOrcaCli(
  userDataDir: string,
  env: Record<string, string>,
  args: string[]
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [ORCA_CLI_ENTRY, ...args], {
    env: {
      ...orcaCliBaseEnv(),
      ORCA_USER_DATA_PATH: userDataDir,
      ORCA_DEV_CLI_INVOCATION: '1',
      ...env
    },
    encoding: 'utf8',
    timeout: 60_000
  })
}
