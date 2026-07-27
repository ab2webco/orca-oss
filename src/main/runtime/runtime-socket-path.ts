import { createHash } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RuntimeTransportMetadata } from '../../shared/runtime-bootstrap'

export const UNIX_SOCKET_PATH_LIMIT_BYTES = {
  darwin: 104,
  linux: 108
} as const

type RuntimeSocketPathOptions = {
  temporaryDirectory?: string
}

function unixSocketPathLimit(platform: NodeJS.Platform): number {
  return platform === 'linux'
    ? UNIX_SOCKET_PATH_LIMIT_BYTES.linux
    : UNIX_SOCKET_PATH_LIMIT_BYTES.darwin
}

function runtimeEndpointSuffix(runtimeId: string): string {
  return runtimeId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 4) || 'rt'
}

function runtimeSocketName(pid: number, endpointSuffix: string): string {
  return `o-${pid}-${endpointSuffix}.sock`
}

function fallbackUserIdentity(): string {
  return typeof process.getuid === 'function' ? String(process.getuid()) : 'user'
}

export function getRuntimeSocketFallbackDirectory(
  userDataPath: string,
  temporaryDirectory = tmpdir()
): string {
  const profileHash = createHash('sha256').update(userDataPath).digest('hex').slice(0, 16)
  return join(temporaryDirectory, `orca-rpc-${fallbackUserIdentity()}-${profileHash}`)
}

export function getRuntimeSocketDirectories(
  userDataPath: string,
  platform: NodeJS.Platform,
  temporaryDirectory = tmpdir()
): string[] {
  if (platform === 'win32') {
    return []
  }
  const fallbackDirectory = getRuntimeSocketFallbackDirectory(userDataPath, temporaryDirectory)
  return fallbackDirectory === userDataPath ? [userDataPath] : [userDataPath, fallbackDirectory]
}

function ensurePrivateFallbackDirectory(directory: string): void {
  try {
    mkdirSync(directory, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }

  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Runtime socket fallback path is not a private directory: ${directory}`)
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(
      `Runtime socket fallback directory is not owned by the current user: ${directory}`
    )
  }
  chmodSync(directory, 0o700)
}

function platformDisplayName(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : platform
}

export function createRuntimeTransportMetadata(
  userDataPath: string,
  pid: number,
  platform: NodeJS.Platform,
  runtimeId = 'runtime',
  options: RuntimeSocketPathOptions = {}
): RuntimeTransportMetadata {
  const endpointSuffix = runtimeEndpointSuffix(runtimeId)
  if (platform === 'win32') {
    return {
      kind: 'named-pipe',
      // Why: named pipes lack Unix socket chmod hardening, so keep the per-runtime suffix.
      endpoint: `\\\\.\\pipe\\orca-${pid}-${endpointSuffix}`
    }
  }

  const socketName = runtimeSocketName(pid, endpointSuffix)
  const limit = unixSocketPathLimit(platform)
  const primaryEndpoint = join(userDataPath, socketName)
  if (Buffer.byteLength(primaryEndpoint, 'utf8') < limit) {
    return { kind: 'unix', endpoint: primaryEndpoint }
  }

  const fallbackDirectory = getRuntimeSocketFallbackDirectory(
    userDataPath,
    options.temporaryDirectory
  )
  const fallbackEndpoint = join(fallbackDirectory, socketName)
  const fallbackBytes = Buffer.byteLength(fallbackEndpoint, 'utf8')
  if (fallbackBytes >= limit) {
    throw new Error(
      `Unix socket path exceeds the ${limit}-byte ${platformDisplayName(platform)} sun_path limit: ` +
        `primary endpoint is ${Buffer.byteLength(primaryEndpoint, 'utf8')} bytes and fallback endpoint is ${fallbackBytes} bytes`
    )
  }

  ensurePrivateFallbackDirectory(fallbackDirectory)
  return { kind: 'unix', endpoint: fallbackEndpoint }
}
