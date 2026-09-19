import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import {
  findTransport,
  getRuntimeMetadataPath,
  type RuntimeMetadata
} from '../../shared/runtime-bootstrap'
import { localAttachRecoveryData } from './local-attach-recovery'
import { isProcessRunning } from './runtime-process-liveness'
import { RuntimeClientError } from './types'

/** Directory names Orca has written its Linux userData under. A search order, not
 *  the answer: the packaged build follows `executableName` ('orca-ide'), dev runs
 *  use 'orca-dev', and installs predating the pin used 'orca'. */
const LINUX_USER_DATA_DIR_NAMES = ['orca-ide', 'orca', 'orca-dev'] as const

/** Answer when no directory holds runtime metadata at all, so a first run still
 *  reports the path the CLI has always named. */
const LINUX_FALLBACK_USER_DATA_DIR_NAME = 'orca'

export function readMetadata(userDataPath: string): RuntimeMetadata {
  const metadataPath = getRuntimeMetadataPath(userDataPath)
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as RuntimeMetadata | null
    if (!metadata || !findTransport(metadata, 'unix', 'named-pipe') || !metadata.authToken) {
      throw new RuntimeClientError(
        'runtime_unavailable',
        `Orca Lab runtime metadata is incomplete at ${metadataPath}${describeOtherSearchedPaths(userDataPath)}`,
        localAttachRecoveryData()
      )
    }
    return metadata
  } catch (error) {
    if (error instanceof RuntimeClientError) {
      throw error
    }
    throw new RuntimeClientError(
      'runtime_unavailable',
      `Could not read Orca Lab runtime metadata at ${metadataPath}.${describeOtherSearchedPaths(userDataPath)}`,
      localAttachRecoveryData()
    )
  }
}

export function tryReadMetadata(userDataPath: string): RuntimeMetadata | null {
  const metadataPath = getRuntimeMetadataPath(userDataPath)
  try {
    return JSON.parse(readFileSync(metadataPath, 'utf8')) as RuntimeMetadata | null
  } catch {
    return null
  }
}

export function getDefaultUserDataPath(
  platform: NodeJS.Platform = process.platform,
  homeDir = homedir()
): string {
  // Why: in dev mode (and for parallel Orca instances), the Electron app writes
  // runtime metadata to a separate userData directory (e.g. `orca-dev`) to avoid
  // clobbering the production app's metadata. The CLI needs to find the same
  // metadata file, so this env var lets the CLI target a specific instance.
  if (process.env.ORCA_USER_DATA_PATH) {
    return process.env.ORCA_USER_DATA_PATH
  }
  if (platform === 'darwin') {
    return join(homeDir, 'Library', 'Application Support', 'orca')
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA
    if (!appData) {
      throw new RuntimeClientError(
        'runtime_unavailable',
        'APPDATA is not set, so the Orca Lab runtime metadata path cannot be resolved.'
      )
    }
    return join(appData, 'orca')
  }
  return resolveLinuxUserDataPath(getLinuxUserDataBase(homeDir))
}

/** Base Electron derives the Linux (XDG) userData directory from. */
function getLinuxUserDataBase(homeDir: string): string {
  return process.env.XDG_CONFIG_HOME || join(homeDir, '.config')
}

/**
 * Pick the Linux userData directory whose runtime is actually up (ORCA-516).
 *
 * Why probe instead of pinning a name: the packaged build writes under its
 * `executableName` ('orca-ide', because Ubuntu already owns /usr/bin/orca) while
 * the CLI assumed 'orca', so a shell outside Orca read a retired install's
 * metadata and reported "Could not connect to the Orca Lab runtime transport
 * from this shell" with the app running. Liveness decides; recency only breaks
 * ties, since a newer orca-runtime.json can point at a socket nobody holds.
 */
function resolveLinuxUserDataPath(base: string): string {
  const candidates = listLinuxUserDataCandidates(base)
  const live = candidates.filter(hasReachableRuntime)
  return (
    // Why fall back to the dead set rather than nothing: the caller still has to
    // name a directory in its error, and the freshest one is the likeliest.
    newestRuntimeMetadata(live.length > 0 ? live : candidates) ??
    join(base, LINUX_FALLBACK_USER_DATA_DIR_NAME)
  )
}

/** Every userData directory under `base` that holds runtime metadata, known names
 *  first. Discovery is not optional: the name list cannot be assumed complete, so
 *  a build packaged under a name this fork never shipped is still found. */
function listLinuxUserDataCandidates(base: string): string[] {
  const known = LINUX_USER_DATA_DIR_NAMES.map((name) => join(base, name))
  const discovered = readBaseDirectoryNames(base)
    .map((name) => join(base, name))
    .filter((path) => !known.includes(path))
  return [...known, ...discovered].filter((path) => existsSync(getRuntimeMetadataPath(path)))
}

function readBaseDirectoryNames(base: string): string[] {
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * True when the recorded endpoint is still on disk and the process that bound it
 * is still alive.
 *
 * Why not dial the socket: this resolves on every CLI invocation and Node has no
 * synchronous connect, so a real handshake would either make the whole CLI async
 * or spend a per-directory timeout on every command. Endpoint plus live owner
 * costs microseconds and still separates a running install from the stale one.
 */
function hasReachableRuntime(userDataPath: string): boolean {
  const metadata = tryReadMetadata(userDataPath)
  if (!metadata) {
    return false
  }
  // Why authToken: readMetadata rejects a tokenless file, so a directory holding
  // one is not an answer no matter how alive its socket looks.
  const transport = findTransport(metadata, 'unix', 'named-pipe')
  if (!transport?.endpoint || !metadata.authToken || !existsSync(transport.endpoint)) {
    return false
  }
  return isProcessRunning(metadata.pid)
}

function newestRuntimeMetadata(paths: readonly string[]): string | null {
  let newest: { path: string; mtimeMs: number } | null = null
  for (const path of paths) {
    const mtimeMs = runtimeMetadataMtimeMs(path)
    if (!newest || mtimeMs > newest.mtimeMs) {
      newest = { path, mtimeMs }
    }
  }
  return newest?.path ?? null
}

function runtimeMetadataMtimeMs(userDataPath: string): number {
  try {
    return statSync(getRuntimeMetadataPath(userDataPath)).mtimeMs
  } catch {
    return 0
  }
}

/** The other directories the resolution looked at — without them the error names
 *  one path and hides that the runtime was found nowhere. Stays silent for a
 *  userDataPath the caller chose itself, which no search produced. */
function describeOtherSearchedPaths(chosen: string): string {
  const base = getLinuxUserDataBase(homedir())
  if (!chosen.startsWith(base + sep)) {
    return ''
  }
  const others = listLinuxUserDataCandidates(base).filter((path) => path !== chosen)
  return others.length > 0 ? ` Also searched ${others.join(', ')}.` : ''
}
