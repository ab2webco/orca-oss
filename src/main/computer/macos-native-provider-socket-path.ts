import { chmodSync, lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UNIX_SOCKET_PATH_LIMIT_BYTES } from '../runtime/runtime-socket-path'

export type MacOSNativeProviderSocketPaths = {
  socketDirectory: string
  socketPath: string
  tokenPath: string
}

type MacOSNativeProviderSocketPathOptions = {
  temporaryDirectory?: string
  fallbackDirectory?: string
}

function ensurePrivateDirectory(directory: string): void {
  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`macOS native provider socket path is not a private directory: ${directory}`)
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(
      `macOS native provider socket directory is not owned by the current user: ${directory}`
    )
  }
  chmodSync(directory, 0o700)
}

function createCandidate(root: string): MacOSNativeProviderSocketPaths {
  const socketDirectory = mkdtempSync(join(root, 'orca-computer-use-'))
  try {
    ensurePrivateDirectory(socketDirectory)
    return {
      socketDirectory,
      socketPath: join(socketDirectory, 'provider.sock'),
      tokenPath: join(socketDirectory, 'provider.token')
    }
  } catch (error) {
    rmSync(socketDirectory, { recursive: true, force: true })
    throw error
  }
}

export function createMacOSNativeProviderSocketPaths(
  options: MacOSNativeProviderSocketPathOptions = {}
): MacOSNativeProviderSocketPaths {
  const primary = createCandidate(options.temporaryDirectory ?? tmpdir())
  const limit = UNIX_SOCKET_PATH_LIMIT_BYTES.darwin
  const primaryBytes = Buffer.byteLength(primary.socketPath, 'utf8')
  if (primaryBytes < limit) {
    return primary
  }
  rmSync(primary.socketDirectory, { recursive: true, force: true })

  const fallback = createCandidate(options.fallbackDirectory ?? '/tmp')
  const fallbackBytes = Buffer.byteLength(fallback.socketPath, 'utf8')
  if (fallbackBytes < limit) {
    return fallback
  }
  rmSync(fallback.socketDirectory, { recursive: true, force: true })
  throw new Error(
    `macOS native provider socket path exceeds the ${limit}-byte macOS sun_path limit: ` +
      `primary endpoint is ${primaryBytes} bytes and fallback endpoint is ${fallbackBytes} bytes`
  )
}
