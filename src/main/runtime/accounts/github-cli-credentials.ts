import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Where gh keeps its credentials, honouring the same overrides gh itself reads. */
export function resolveGhConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.GH_CONFIG_DIR?.trim()
  if (explicit) {
    return explicit
  }
  const xdg = env.XDG_CONFIG_HOME?.trim()
  return join(xdg || join(homedir(), '.config'), 'gh')
}

export type GithubCliImportResult = {
  authenticated: boolean
  /** The gh host the imported credentials belong to, for the caller to report. */
  hostname: string | null
}

/** Move a completed `gh auth login` result into this host's real gh config.
 *
 *  Why a move and not "just log in there directly": the sign-in runs against a
 *  throwaway GH_CONFIG_DIR so an abandoned or failed attempt can never leave a
 *  half-written hosts.yml where gh would read it — the same reason the agent
 *  sign-ins write to a temporary home first.
 */
export function importGithubCliCredentials(
  sourceConfigDir: string,
  targetConfigDir: string = resolveGhConfigDir()
): GithubCliImportResult {
  const sourceHosts = join(sourceConfigDir, 'hosts.yml')
  if (!existsSync(sourceHosts)) {
    return { authenticated: false, hostname: null }
  }
  mkdirSync(targetConfigDir, { recursive: true })
  const targetHosts = join(targetConfigDir, 'hosts.yml')
  // Why staged through a sibling and renamed: gh reads hosts.yml on every
  // invocation, and a partial copy is a file gh parses as broken auth. rename
  // within one directory is atomic, so gh sees either the old file or the new.
  const staged = `${targetHosts}.orca-import`
  try {
    copyFileSync(sourceHosts, staged)
    renameSync(staged, targetHosts)
  } catch (error) {
    rmSync(staged, { force: true })
    throw error
  }
  return {
    authenticated: true,
    // Top-level YAML keys in hosts.yml are the hostnames; gh writes exactly the
    // one it signed into, so the first is the one this sign-in produced.
    hostname: readFirstHostname(targetHosts)
  }
}

function readFirstHostname(hostsPath: string): string | null {
  try {
    for (const line of readFileSync(hostsPath, 'utf8').split('\n')) {
      const match = /^([A-Za-z0-9.:-]+):\s*$/.exec(line)
      if (match) {
        return match[1]
      }
    }
  } catch {
    // A hostname is for the message only; a readable file that parses oddly
    // must not fail an import that already landed.
  }
  return null
}
