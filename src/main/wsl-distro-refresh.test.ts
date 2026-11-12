import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as childProcess from 'node:child_process'

const { execFileMock, execFileSyncMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  execFileSyncMock: vi.fn()
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>()
  return {
    ...actual,
    execFile: execFileMock,
    execFileSync: execFileSyncMock
  }
})

import { _resetWslCachesForTests, listWslDistros, listWslDistrosAsync } from './wsl'

async function withPlatformAsync<T>(value: NodeJS.Platform, fn: () => Promise<T>): Promise<T> {
  const original = process.platform
  Object.defineProperty(process, 'platform', { configurable: true, value })
  try {
    return await fn()
  } finally {
    Object.defineProperty(process, 'platform', { configurable: true, value: original })
  }
}

describe('WSL distro list refresh on async reads', () => {
  afterEach(() => {
    execFileMock.mockReset()
    execFileSyncMock.mockReset()
    _resetWslCachesForTests()
  })

  // Why: a distro installed while Orca runs must reach Settings without a restart.
  it('re-probes a known distro list asynchronously once it is a minute old', async () => {
    vi.useFakeTimers()
    execFileMock
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, 'Ubuntu\n')
      })
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, 'Ubuntu\nUbuntu-24.04\n')
      })

    try {
      await withPlatformAsync('win32', async () => {
        await expect(listWslDistrosAsync()).resolves.toEqual(['Ubuntu'])
        vi.advanceTimersByTime(59_000)
        await expect(listWslDistrosAsync()).resolves.toEqual(['Ubuntu'])
        expect(execFileMock).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(1_000)
        await expect(listWslDistrosAsync()).resolves.toEqual(['Ubuntu', 'Ubuntu-24.04'])
        // The synchronous spawn path keeps the cached list instead of blocking on wsl.exe.
        expect(listWslDistros()).toEqual(['Ubuntu', 'Ubuntu-24.04'])
        expect(execFileSyncMock).not.toHaveBeenCalled()
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits a full minute again after a re-probe that came back empty', async () => {
    vi.useFakeTimers()
    execFileMock
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, 'Ubuntu\n')
      })
      .mockImplementation((_command, _args, _options, callback) => {
        callback(null, '')
      })

    try {
      await withPlatformAsync('win32', async () => {
        await listWslDistrosAsync()
        vi.advanceTimersByTime(60_000)
        await expect(listWslDistrosAsync()).resolves.toEqual(['Ubuntu'])
        await expect(listWslDistrosAsync()).resolves.toEqual(['Ubuntu'])
        expect(execFileMock).toHaveBeenCalledTimes(2)
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts one re-probe for concurrent reads of a stale known list', async () => {
    vi.useFakeTimers()
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(null, 'Ubuntu\n')
    })

    try {
      await withPlatformAsync('win32', async () => {
        await listWslDistrosAsync()
        vi.advanceTimersByTime(60_000)
        await Promise.all([listWslDistrosAsync(), listWslDistrosAsync(), listWslDistrosAsync()])
        expect(execFileMock).toHaveBeenCalledTimes(2)
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
