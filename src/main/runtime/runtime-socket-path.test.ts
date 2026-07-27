import { existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createRuntimeTransportMetadata,
  getRuntimeSocketFallbackDirectory,
  UNIX_SOCKET_PATH_LIMIT_BYTES
} from './runtime-socket-path'

describe('runtime socket path', () => {
  it.each([
    ['darwin', 104],
    ['linux', 108]
  ] as const)('uses a bounded fallback for an oversized %s endpoint', (platform, limit) => {
    const temporaryDirectory = '/tmp'
    const userDataPath = join('/profiles', `${platform}-${'u'.repeat(limit)}`)

    const transport = createRuntimeTransportMetadata(userDataPath, 12345, platform, 'runtime', {
      temporaryDirectory
    })

    expect(transport.kind).toBe('unix')
    expect(transport.endpoint.startsWith(userDataPath)).toBe(false)
    expect(Buffer.byteLength(transport.endpoint, 'utf8')).toBeLessThan(limit)
    expect(UNIX_SOCKET_PATH_LIMIT_BYTES[platform]).toBe(limit)
  })

  it('gives distinct userData profiles distinct stable fallbacks', () => {
    const temporaryDirectory = '/tmp'
    const first = createRuntimeTransportMetadata(
      join(temporaryDirectory, 'a'.repeat(120)),
      123,
      'darwin',
      'runtime',
      { temporaryDirectory }
    )
    const second = createRuntimeTransportMetadata(
      join(temporaryDirectory, 'b'.repeat(120)),
      123,
      'darwin',
      'runtime',
      { temporaryDirectory }
    )
    const firstAgain = createRuntimeTransportMetadata(
      join(temporaryDirectory, 'a'.repeat(120)),
      123,
      'darwin',
      'runtime',
      { temporaryDirectory }
    )

    expect(first.endpoint).not.toBe(second.endpoint)
    expect(firstAgain.endpoint).toBe(first.endpoint)
  })

  it.runIf(process.platform !== 'win32')('creates the fallback directory with mode 0700', () => {
    const temporaryDirectory = '/tmp'
    const userDataPath = join('/profiles', `mode-${process.pid}-${'u'.repeat(120)}`)
    const transport = createRuntimeTransportMetadata(userDataPath, 123, 'darwin', 'runtime', {
      temporaryDirectory
    })
    const fallbackDirectory = getRuntimeSocketFallbackDirectory(userDataPath, temporaryDirectory)

    expect(transport.endpoint.startsWith(fallbackDirectory)).toBe(true)
    expect(existsSync(fallbackDirectory)).toBe(true)
    expect(statSync(fallbackDirectory).mode & 0o777).toBe(0o700)
  })

  it.each([
    ['darwin', 104, 'macOS'],
    ['linux', 108, 'Linux']
  ] as const)(
    'names the %s sun_path limit when both endpoints are oversized',
    (platform, limit, platformName) => {
      const temporaryDirectory = join(tmpdir(), 't'.repeat(limit))
      const userDataPath = join(tmpdir(), 'u'.repeat(limit))

      expect(() =>
        createRuntimeTransportMetadata(userDataPath, 123, platform, 'runtime', {
          temporaryDirectory
        })
      ).toThrow(`Unix socket path exceeds the ${limit}-byte ${platformName} sun_path limit`)
    }
  )

  it('keeps Windows on its named-pipe namespace', () => {
    const transport = createRuntimeTransportMetadata(
      join(tmpdir(), 'u'.repeat(200)),
      123,
      'win32',
      'runtime'
    )

    expect(transport).toEqual({
      kind: 'named-pipe',
      endpoint: '\\\\.\\pipe\\orca-123-runt'
    })
  })
})
