import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const processMocks = vi.hoisted(() => ({ fork: vi.fn(), execFile: vi.fn() }))
vi.mock('node:child_process', () => processMocks)

import { startPluginWorker } from './plugin-host-process'

class FakeChild extends EventEmitter {
  connected = true
  stdout = new PassThrough()
  stderr = new PassThrough()
  send = vi.fn()
  kill = vi.fn()
  pid = 4321
}

function start(
  child: FakeChild,
  options: {
    eventTimeoutMs?: number
    networkHosts?: readonly string[]
    grantedCapabilities?: readonly ['process:spawn']
  } = {}
) {
  processMocks.fork.mockReturnValue(child)
  return startPluginWorker({
    pluginId: 'orca-samples.demo',
    rootDir: '/plugin',
    mainEntry: 'worker.js',
    entryPath: '/host.js',
    grantedCapabilities: [],
    executeHostCall: async () => ({ ok: true, value: null }),
    log: vi.fn(),
    ...options
  })
}

beforeEach(() => {
  processMocks.fork.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('startPluginWorker', () => {
  it('starts with the permission model and network preload instead of inheriting execArgv', async () => {
    const child = new FakeChild()
    const pending = start(child)
    child.emit('message', { type: 'ready', commands: [] })
    await pending

    expect(processMocks.fork).toHaveBeenCalledWith(
      '/host.js',
      [],
      expect.objectContaining({
        execArgv: [
          '--preserve-symlinks',
          '--preserve-symlinks-main',
          '--permission',
          '--allow-fs-read=/plugin',
          '--allow-fs-read=/',
          '--require',
          '/plugin-host-preload.js'
        ]
      })
    )
  })

  it('adds child-process permission only for the exact approved grant', async () => {
    const deniedChild = new FakeChild()
    const deniedPending = start(deniedChild)
    deniedChild.emit('message', { type: 'ready', commands: [] })
    await deniedPending

    const allowedChild = new FakeChild()
    const allowedPending = start(allowedChild, { grantedCapabilities: ['process:spawn'] })
    allowedChild.emit('message', { type: 'ready', commands: [] })
    await allowedPending

    const deniedArgv = processMocks.fork.mock.calls[0]?.[2]?.execArgv
    const allowedArgv = processMocks.fork.mock.calls[1]?.[2]?.execArgv
    expect(deniedArgv).not.toContain('--allow-child-process')
    expect(allowedArgv).toContain('--allow-child-process')
  })

  it('passes only the consented network host scope to the preload', async () => {
    const child = new FakeChild()
    const pending = start(child, { networkHosts: ['api.example.com'] })
    child.emit('message', { type: 'ready', commands: [] })
    await pending

    expect(processMocks.fork).toHaveBeenCalledWith(
      '/host.js',
      [],
      expect.objectContaining({
        env: expect.objectContaining({
          ORCA_PLUGIN_NET_FETCH_HOSTS: '["api.example.com"]'
        })
      })
    )
  })

  it('replays an exit that happened before handle registration', async () => {
    const child = new FakeChild()
    const pending = start(child)
    child.emit('message', { type: 'ready', commands: ['run'] })
    const handle = await pending
    child.emit('exit', 23)
    const onExit = vi.fn()

    handle.onExit(onExit)

    expect(onExit).toHaveBeenCalledOnce()
    expect(onExit).toHaveBeenCalledWith(23)
  })

  it.runIf(process.platform !== 'win32')(
    'terminates the process group when process spawning was consented',
    async () => {
      const child = new FakeChild()
      const killProcess = vi.spyOn(process, 'kill').mockImplementation(() => true)
      const pending = start(child, { grantedCapabilities: ['process:spawn'] })
      child.emit('message', { type: 'ready', commands: [] })
      const handle = await pending

      handle.kill()

      expect(killProcess).toHaveBeenCalledWith(-child.pid, 'SIGKILL')
      Object.defineProperty(process, 'platform', { value: 'win32' })
      processMocks.execFile.mockImplementation((...args) =>
        args.at(-1)(new Error('taskkill failed'))
      )
      handle.kill()
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    }
  )

  it('kills a live worker that disconnects its IPC channel', async () => {
    const child = new FakeChild()
    const pending = start(child)
    child.emit('message', { type: 'ready', commands: ['run'] })
    const handle = await pending
    const command = handle.invokeCommand('run')
    child.connected = false

    child.emit('disconnect')

    await expect(command).rejects.toThrow('disconnected')
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('counts delivered events as in flight until their acknowledgement', async () => {
    const child = new FakeChild()
    const pending = start(child)
    child.emit('message', { type: 'ready', commands: [] })
    const handle = await pending

    handle.deliverEvent('worktree.created', {
      worktreeId: 'worktree-1',
      path: '/repo',
      branch: 'feature'
    })

    expect(handle.inFlightCount()).toBe(1)
    child.emit('message', { type: 'eventAck', eventId: 0 })
    expect(handle.inFlightCount()).toBe(0)
  })

  it('kills a worker whose event handler never acknowledges completion', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    const pending = start(child, { eventTimeoutMs: 25 })
    child.emit('message', { type: 'ready', commands: [] })
    const handle = await pending

    handle.deliverEvent('worktree.created', {
      worktreeId: 'worktree-1',
      path: '/repo',
      branch: 'feature'
    })
    await vi.advanceTimersByTimeAsync(25)

    expect(handle.inFlightCount()).toBe(0)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('kills a worker that exceeds the pending event cap', async () => {
    const child = new FakeChild()
    const pending = start(child)
    child.emit('message', { type: 'ready', commands: [] })
    const handle = await pending

    for (let index = 0; index < 65; index += 1) {
      handle.deliverEvent('agent.status.changed', {
        worktreeId: null,
        paneKey: `pane-${index}`,
        state: 'working',
        receivedAt: Date.now()
      })
    }

    expect(handle.inFlightCount()).toBe(64)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })
})
