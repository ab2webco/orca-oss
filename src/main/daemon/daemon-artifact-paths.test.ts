import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getDaemonArtifactPaths, getDaemonFallbackDirectory } from './daemon-artifact-paths'

const createdPaths: string[] = []

afterEach(() => {
  for (const path of createdPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('daemon artifact paths', () => {
  it.each([
    ['darwin', 104],
    ['linux', 108]
  ] as const)('keeps an oversized %s endpoint below its sun_path limit', (platform, limit) => {
    const runtimeDir = join('/profiles', `${platform}-${'u'.repeat(limit)}`, 'daemon')
    const paths = getDaemonArtifactPaths(runtimeDir, 28, {
      platform,
      temporaryDirectory: '/tmp'
    })

    createdPaths.push(dirname(paths.socketPath))
    expect(Buffer.byteLength(paths.socketPath, 'utf8')).toBeLessThan(limit)
    expect(paths.socketPath.startsWith(runtimeDir)).toBe(false)
  })

  it('keeps the socket, token, and pid in the same fallback directory', () => {
    const runtimeDir = join('/profiles', 'u'.repeat(140), 'daemon')
    const paths = getDaemonArtifactPaths(runtimeDir, 28, {
      platform: 'darwin',
      temporaryDirectory: '/tmp'
    })

    createdPaths.push(dirname(paths.socketPath))
    expect(dirname(paths.tokenPath)).toBe(dirname(paths.socketPath))
    expect(dirname(paths.pidPath)).toBe(dirname(paths.socketPath))
    expect(paths).toEqual({
      socketPath: join(dirname(paths.socketPath), 'daemon-v28.sock'),
      tokenPath: join(dirname(paths.socketPath), 'daemon-v28.token'),
      pidPath: join(dirname(paths.socketPath), 'daemon-v28.pid')
    })
  })

  it('keeps an already-running daemon on its original endpoint', () => {
    const root = join(tmpdir(), `daemon-live-${process.pid}-${Date.now()}`)
    const runtimeDir = join(root, 'u'.repeat(120))
    mkdirSync(runtimeDir, { recursive: true })
    for (const extension of ['sock', 'token', 'pid']) {
      writeFileSync(join(runtimeDir, `daemon-v28.${extension}`), '')
    }
    createdPaths.push(root)

    const paths = getDaemonArtifactPaths(runtimeDir, 28, {
      platform: 'darwin',
      temporaryDirectory: '/tmp',
      hasExistingDaemon: () => true
    })

    expect(paths.socketPath).toBe(join(runtimeDir, 'daemon-v28.sock'))
    expect(paths.tokenPath).toBe(join(runtimeDir, 'daemon-v28.token'))
    expect(paths.pidPath).toBe(join(runtimeDir, 'daemon-v28.pid'))
  })

  it('keeps protocol versions isolated in the fallback directory', () => {
    const runtimeDir = join('/profiles', 'u'.repeat(140), 'daemon')
    const current = getDaemonArtifactPaths(runtimeDir, 28, {
      platform: 'linux',
      temporaryDirectory: '/tmp'
    })
    const older = getDaemonArtifactPaths(runtimeDir, 27, {
      platform: 'linux',
      temporaryDirectory: '/tmp'
    })

    createdPaths.push(getDaemonFallbackDirectory(runtimeDir, '/tmp'))
    expect(current.socketPath).not.toBe(older.socketPath)
    expect(current.socketPath.endsWith('daemon-v28.sock')).toBe(true)
    expect(older.socketPath.endsWith('daemon-v27.sock')).toBe(true)
  })

  it('leaves the Windows named pipe unchanged', () => {
    const runtimeDir = join('C:\\', 'profiles', 'u'.repeat(180), 'daemon')

    expect(
      getDaemonArtifactPaths(runtimeDir, 28, {
        platform: 'win32',
        temporaryDirectory: '/ignored'
      })
    ).toEqual({
      socketPath: expect.stringMatching(/^\\\\\?\\pipe\\orca-terminal-host-v28-[a-f0-9]{12}$/),
      tokenPath: join(runtimeDir, 'daemon-v28.token'),
      pidPath: join(runtimeDir, 'daemon-v28.pid')
    })
  })

  it.each([
    ['darwin', 104, 'macOS'],
    ['linux', 108, 'Linux']
  ] as const)(
    'reports measured %s endpoints when no path fits',
    (platform, limit, platformName) => {
      const runtimeDir = join(tmpdir(), 'u'.repeat(limit), 'daemon')
      const temporaryDirectory = join(tmpdir(), 't'.repeat(limit))

      expect(() =>
        getDaemonArtifactPaths(runtimeDir, 28, { platform, temporaryDirectory })
      ).toThrow(
        new RegExp(
          `Unix daemon socket path exceeds the ${limit}-byte ${platformName} sun_path limit: ` +
            `primary endpoint is \\d+ bytes and fallback endpoint is \\d+ bytes`
        )
      )
    }
  )
})
