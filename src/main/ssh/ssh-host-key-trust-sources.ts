/** Reads ssh's known_hosts and Orca's own accepted-key store; never writes the user's known_hosts. */
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { getCanonicalUserDataPath } from '../persistence'
import { parseKnownHosts, type KnownHostsEntry } from './ssh-known-hosts'

export type HostKeyTrustSources = {
  knownHosts: KnownHostsEntry[]
  /** An existing file we could not read may hide a mismatch, so first contact is not recorded. */
  knownHostsUnreadable: boolean
  orcaStore: KnownHostsEntry[]
}

/** Used when ssh -G reported nothing; an empty list must never mean "no trust source". */
function defaultKnownHostsFiles(): string[] {
  const files = [join(homedir(), '.ssh', 'known_hosts'), join(homedir(), '.ssh', 'known_hosts2')]
  return process.platform === 'win32'
    ? files
    : [...files, '/etc/ssh/ssh_known_hosts', '/etc/ssh/ssh_known_hosts2']
}

function orcaHostKeyStorePath(): string {
  return join(getCanonicalUserDataPath(), 'ssh', 'known_hosts')
}

async function readEntries(
  path: string
): Promise<{ entries: KnownHostsEntry[]; unreadable: boolean }> {
  try {
    return {
      entries: parseKnownHosts(await readFile(path, 'utf8')),
      unreadable: false
    }
  } catch (err) {
    return {
      entries: [],
      unreadable: (err as NodeJS.ErrnoException).code !== 'ENOENT'
    }
  }
}

export async function loadHostKeyTrustSources(
  knownHostsFiles: readonly string[]
): Promise<HostKeyTrustSources> {
  const files =
    knownHostsFiles.length > 0 ? [...new Set(knownHostsFiles)] : defaultKnownHostsFiles()
  const [known, store] = await Promise.all([
    Promise.all(files.map(readEntries)),
    readEntries(orcaHostKeyStorePath())
  ])
  return {
    knownHosts: known.flatMap((file) => file.entries),
    knownHostsUnreadable: known.some((file) => file.unreadable),
    // An unreadable store only loses Orca-recorded trust; known_hosts still applies.
    orcaStore: store.entries
  }
}

/** Hosts come from ssh config; anything that could split or mark a known_hosts line is not stored. */
const UNSAFE_HOST = /[\s,#@|!*?[\]]/
const SAFE_KEY_TYPE = /^[a-z0-9@.-]+$/i

export async function rememberHostKey(record: {
  host: string
  port: number
  keyType: string
  key: Buffer
}): Promise<void> {
  const host = record.host.toLowerCase()
  if (!host || UNSAFE_HOST.test(host) || !SAFE_KEY_TYPE.test(record.keyType)) {
    return
  }
  const pattern = record.port === 22 ? host : `[${host}]:${record.port}`
  const path = orcaHostKeyStorePath()
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  // O_APPEND keeps one line whole when two connects record at once.
  await appendFile(path, `${pattern} ${record.keyType} ${record.key.toString('base64')}\n`, {
    mode: 0o600
  })
}
