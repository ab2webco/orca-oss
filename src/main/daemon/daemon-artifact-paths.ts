import { createHash } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UNIX_SOCKET_PATH_LIMIT_BYTES } from '../runtime/runtime-socket-path'

export type DaemonArtifactPaths = {
  socketPath: string
  tokenPath: string
  pidPath: string
}

type DaemonArtifactPathOptions = {
  platform?: NodeJS.Platform
  temporaryDirectory?: string
  hasExistingDaemon?: (paths: DaemonArtifactPaths) => boolean
}

function daemonPaths(directory: string, protocolVersion: number): DaemonArtifactPaths {
  return {
    socketPath: join(directory, `daemon-v${protocolVersion}.sock`),
    tokenPath: join(directory, `daemon-v${protocolVersion}.token`),
    pidPath: join(directory, `daemon-v${protocolVersion}.pid`)
  }
}

function fallbackUserIdentity(): string {
  return typeof process.getuid === 'function' ? String(process.getuid()) : 'user'
}

export function getDaemonFallbackDirectory(
  runtimeDir: string,
  temporaryDirectory = tmpdir()
): string {
  const runtimeHash = createHash('sha256').update(runtimeDir).digest('hex').slice(0, 16)
  return join(temporaryDirectory, `orca-daemon-${fallbackUserIdentity()}-${runtimeHash}`)
}

function hasExistingDaemon(paths: DaemonArtifactPaths): boolean {
  try {
    // Why: token creation follows listen, so the socket alone preserves an in-flight daemon start.
    return lstatSync(paths.socketPath).isSocket()
  } catch {
    return false
  }
}

function ensurePrivateDirectory(directory: string): void {
  try {
    mkdirSync(directory, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }

  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Daemon fallback path is not a private directory: ${directory}`)
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(`Daemon fallback directory is not owned by the current user: ${directory}`)
  }
  chmodSync(directory, 0o700)
}

function platformDisplayName(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : platform
}

export function getDaemonArtifactPaths(
  runtimeDir: string,
  protocolVersion: number,
  options: DaemonArtifactPathOptions = {}
): DaemonArtifactPaths {
  const platform = options.platform ?? process.platform
  const primary = daemonPaths(runtimeDir, protocolVersion)
  if (platform === 'win32') {
    const suffix = createHash('sha256').update(runtimeDir).digest('hex').slice(0, 12)
    return {
      ...primary,
      socketPath: `\\\\?\\pipe\\orca-terminal-host-v${protocolVersion}-${suffix}`
    }
  }

  const limit =
    platform === 'linux' ? UNIX_SOCKET_PATH_LIMIT_BYTES.linux : UNIX_SOCKET_PATH_LIMIT_BYTES.darwin
  const primaryBytes = Buffer.byteLength(primary.socketPath, 'utf8')
  const existingDaemon = options.hasExistingDaemon ?? hasExistingDaemon
  if (primaryBytes < limit || existingDaemon(primary)) {
    return primary
  }

  const fallbackDirectory = getDaemonFallbackDirectory(
    runtimeDir,
    options.temporaryDirectory ?? tmpdir()
  )
  const fallback = daemonPaths(fallbackDirectory, protocolVersion)
  const fallbackBytes = Buffer.byteLength(fallback.socketPath, 'utf8')
  if (fallbackBytes >= limit) {
    throw new Error(
      `Unix daemon socket path exceeds the ${limit}-byte ${platformDisplayName(platform)} sun_path limit: ` +
        `primary endpoint is ${primaryBytes} bytes and fallback endpoint is ${fallbackBytes} bytes`
    )
  }

  ensurePrivateDirectory(fallbackDirectory)
  return fallback
}
