import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PROBE_TIMEOUT_MS = 3_000

/** One environment variable read from a live process, or null when the process's
 *  environment cannot be read at all on this platform. */
export type LiveProcessEnvironmentValue = { value: string | null }

/**
 * Reads one environment variable from another live process.
 *
 * Returns null — meaning "unreadable", not "absent" — when the process is gone or
 * the platform offers no way in. Windows exposes no other process's environment
 * without ReadProcessMemory, so it always answers null and callers must keep
 * whatever conservative default they had.
 */
export async function readLiveProcessEnvironmentValue(
  pid: number,
  name: string,
  dependencies: {
    platform?: NodeJS.Platform
    readProcEnviron?: (pid: number) => Promise<string>
    readPsEnvironment?: (pid: number) => Promise<string>
  } = {}
): Promise<LiveProcessEnvironmentValue | null> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null
  }
  const platform = dependencies.platform ?? process.platform
  if (platform === 'linux') {
    try {
      const environ = await (dependencies.readProcEnviron ?? readProcEnviron)(pid)
      return { value: findNulSeparatedValue(environ, name) }
    } catch {
      return null
    }
  }
  if (platform === 'darwin') {
    try {
      const listing = await (dependencies.readPsEnvironment ?? readPsEnvironment)(pid)
      const entries = parsePsEnvironmentEntries(listing)
      // Why no entries means unreadable, not empty: macOS hides another process's
      // environment from a non-root `ps`, and it hides it by printing the command
      // line alone. Reading that as "the variable is absent" would turn a failed
      // probe into a positive answer.
      return entries.length === 0 ? null : { value: findPsListingValue(listing, entries, name) }
    } catch {
      return null
    }
  }
  return null
}

async function readProcEnviron(pid: number): Promise<string> {
  return readFile(`/proc/${pid}/environ`, 'utf8')
}

async function readPsEnvironment(pid: number): Promise<string> {
  const { stdout } = await execFileAsync('ps', ['eww', '-p', String(pid), '-o', 'command='], {
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024
  })
  return stdout
}

function findNulSeparatedValue(environ: string, name: string): string | null {
  for (const entry of environ.split('\0')) {
    if (entry.startsWith(`${name}=`)) {
      return entry.slice(name.length + 1)
    }
  }
  return null
}

// `ps eww` prints the command line followed by space-separated KEY=VALUE pairs, so
// a value containing spaces can only be delimited by the next KEY= token.
const PS_ENVIRONMENT_ENTRY_START = /(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=/g

type PsEnvironmentEntry = { name: string; valueStart: number; entryStart: number }

function parsePsEnvironmentEntries(listing: string): PsEnvironmentEntry[] {
  const entries: PsEnvironmentEntry[] = []
  PS_ENVIRONMENT_ENTRY_START.lastIndex = 0
  for (let match = PS_ENVIRONMENT_ENTRY_START.exec(listing); match; ) {
    entries.push({
      name: match[1],
      valueStart: match.index + match[0].length,
      entryStart: match.index
    })
    PS_ENVIRONMENT_ENTRY_START.lastIndex = match.index + match[0].length
    match = PS_ENVIRONMENT_ENTRY_START.exec(listing)
  }
  return entries
}

function findPsListingValue(
  listing: string,
  entries: readonly PsEnvironmentEntry[],
  name: string
): string | null {
  const index = entries.findIndex((entry) => entry.name === name)
  if (index === -1) {
    return null
  }
  const end = entries[index + 1]?.entryStart ?? listing.length
  return listing.slice(entries[index].valueStart, end).replace(/\s+$/, '')
}
