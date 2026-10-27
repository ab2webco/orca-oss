import { spawn } from 'node:child_process'
import { RuntimeClientError } from './runtime/types'
import { resolveSonarCli, type SonarCliLookup } from '../shared/sonar-cli-location'

export type SonarProcessRunner = (
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv
) => Promise<number>

export type SonarCommandOptions = {
  userDataDir: string
  run: SonarProcessRunner
  // Why: a remote host's files are not on this machine, so a local index would answer for the wrong tree.
  remote?: boolean
}

/** Runs the installed orca-sonar CLI with the caller's arguments and returns its exit code. */
export async function runSonarCommand(
  args: readonly string[],
  options: SonarCommandOptions
): Promise<number> {
  if (options.remote) {
    throw new RuntimeClientError(
      'sonar_remote_unavailable',
      'orca sonar is not available on a remote Orca host: orca-sonar is not installed there and remote installs are not supported yet.'
    )
  }
  const lookup = resolveSonarCli(options.userDataDir)
  if (!lookup.ok) {
    throw new RuntimeClientError('sonar_not_installed', notInstalledMessage(lookup))
  }
  return options.run('node', [lookup.cliPath, ...args], {
    ...process.env,
    ORCA_USER_DATA_PATH: options.userDataDir
  })
}

// Why: the CLI runs on Node 24+ type stripping, so `node` on PATH must be that version.
export const runNodeProcess: SonarProcessRunner = (command, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })

function notInstalledMessage(lookup: Extract<SonarCliLookup, { ok: false }>): string {
  switch (lookup.reason) {
    case 'not_installed':
      return 'orca-sonar is not installed. Install it from Settings > Plugins.'
    case 'invalid_pointer':
      return 'The orca-sonar install pointer is invalid. Reinstall the plugin.'
    case 'missing_entry':
      return 'The orca-sonar install is incomplete. Reinstall the plugin.'
  }
}
