import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ParcelWatcherProcess from './parcel-watcher-process'

const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }))

vi.mock('electron', () => ({ ipcMain: { handle: handleMock } }))
vi.mock('fs/promises', () => ({ stat: vi.fn() }))
vi.mock('@parcel/watcher', () => ({ subscribe: vi.fn() }))
vi.mock('./filesystem-watcher-wsl', () => ({ createWslWatcher: vi.fn() }))
vi.mock('./parcel-watcher-process', async (importOriginal) => {
  const actual = await importOriginal<typeof ParcelWatcherProcess>()
  return { ...actual, subscribeViaWatcherProcess: vi.fn(actual.subscribeViaWatcherProcess) }
})
vi.mock('../providers/ssh-filesystem-dispatch', () => ({
  getSshFilesystemProvider: vi.fn(),
  onSshFilesystemProviderRegistered: () => () => {}
}))

import { closeAllWatchers, registerFilesystemWatcherHandlers } from './filesystem-watcher'
import { stat } from 'node:fs/promises'
import { subscribeViaWatcherProcess } from './parcel-watcher-process'
import { WatcherProcessFailure } from './parcel-watcher-process-failure'

type HandlerMap = Record<string, (_event: unknown, args: unknown) => unknown>

const aborted = (): WatcherProcessFailure =>
  new WatcherProcessFailure(
    'file watcher subscription aborted',
    'subscription',
    'subscribe_aborted'
  )

// The Explorer opened and closed before its watcher came up logged a failure every time (ORCA-1120).
describe('local watcher subscribe cancelled by its last listener', () => {
  const handlers: HandlerMap = {}
  const sender = { isDestroyed: () => false, send: vi.fn(), once: vi.fn(), id: 1 }
  let errorLog: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    handleMock.mockReset()
    handleMock.mockImplementation((channel, handler) => {
      handlers[channel] = handler
    })
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as never)
    vi.mocked(subscribeViaWatcherProcess).mockReset()
    registerFilesystemWatcherHandlers()
    await closeAllWatchers()
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    errorLog.mockRestore()
    await closeAllWatchers()
  })

  const failedLogs = (): unknown[][] =>
    errorLog.mock.calls.filter((call) => String(call[0]).includes('failed to subscribe'))

  it('does not log an abort the unwatch asked for', async () => {
    vi.mocked(subscribeViaWatcherProcess).mockImplementation(
      (_dir, _callback, _options, hooks) =>
        new Promise((_resolve, reject) => {
          hooks?.signal?.addEventListener('abort', () => reject(aborted()), { once: true })
        })
    )
    const watch = handlers['fs:watchWorktree']({ sender }, { worktreePath: '/tmp/repo' })
    await vi.waitFor(() => expect(subscribeViaWatcherProcess).toHaveBeenCalledTimes(1))
    await handlers['fs:unwatchWorktree']({ sender }, { worktreePath: '/tmp/repo' })
    await watch

    expect(failedLogs()).toEqual([])
  })

  it('still logs an abort nobody asked for', async () => {
    vi.mocked(subscribeViaWatcherProcess).mockRejectedValue(aborted())
    await handlers['fs:watchWorktree']({ sender }, { worktreePath: '/tmp/repo' })

    expect(failedLogs()).toHaveLength(1)
  })
})
