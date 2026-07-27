import { mkdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMacOSNativeProviderSocketPaths } from './macos-native-provider-socket-path'

const createdPaths: string[] = []

afterEach(() => {
  for (const path of createdPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

function createLongTemporaryRoot(label: string): string {
  const root = join(tmpdir(), `computer-socket-${label}-${process.pid}-${Date.now()}`)
  const longRoot = join(root, 'x'.repeat(80))
  mkdirSync(longRoot, { recursive: true })
  createdPaths.push(root)
  return longRoot
}

describe('macOS native provider socket paths', () => {
  it('falls back from an oversized TMPDIR endpoint', () => {
    const paths = createMacOSNativeProviderSocketPaths({
      temporaryDirectory: createLongTemporaryRoot('primary'),
      fallbackDirectory: '/tmp'
    })
    createdPaths.push(paths.socketDirectory)

    expect(Buffer.byteLength(paths.socketPath, 'utf8')).toBeLessThan(104)
    expect(paths.socketPath.startsWith('/tmp')).toBe(true)
    expect(paths.tokenPath).toBe(join(paths.socketDirectory, 'provider.token'))
    expect(statSync(paths.socketDirectory).mode & 0o777).toBe(0o700)
  })

  it('reports both measured endpoints when neither temporary root fits', () => {
    const temporaryDirectory = createLongTemporaryRoot('primary-error')
    const fallbackDirectory = createLongTemporaryRoot('fallback-error')

    expect(() =>
      createMacOSNativeProviderSocketPaths({ temporaryDirectory, fallbackDirectory })
    ).toThrow(
      /macOS native provider socket path exceeds the 104-byte macOS sun_path limit: primary endpoint is \d+ bytes and fallback endpoint is \d+ bytes/
    )
  })
})
