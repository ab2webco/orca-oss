import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  SONAR_WARMUP_TIMEOUT_MS,
  scheduleSonarIndexWarmup,
  type SonarWarmupSpawn
} from './sonar-index-warmup'

const HASH = 'd'.repeat(64)

class FakeChild extends EventEmitter {
  readonly kill = vi.fn(() => true)
  readonly unref = vi.fn()
}

describe('scheduleSonarIndexWarmup', () => {
  let userDataDir: string
  let worktreePath: string
  let debug: Mock<(message: string, error: unknown) => void>

  beforeEach(() => {
    vi.useFakeTimers()
    userDataDir = mkdtempSync(join(tmpdir(), 'orca-sonar-warmup-userdata-'))
    worktreePath = mkdtempSync(join(tmpdir(), 'orca-sonar-warmup-worktree-'))
    debug = vi.fn<(message: string, error: unknown) => void>()
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(worktreePath, { recursive: true, force: true })
  })

  function installTree(): string {
    const pluginDir = join(userDataDir, 'plugins', 'ab2web.orca-sonar')
    mkdirSync(join(pluginDir, HASH, 'bin'), { recursive: true })
    const cliPath = join(pluginDir, HASH, 'bin', 'orca-sonar.ts')
    writeFileSync(cliPath, '')
    writeFileSync(join(pluginDir, 'current'), `${HASH}\n`)
    return cliPath
  }

  it('does nothing when the plugin is not installed', () => {
    const spawn = vi.fn()

    scheduleSonarIndexWarmup({ userDataDir, worktreePath, spawn, debug })

    expect(spawn).not.toHaveBeenCalled()
  })

  it('does nothing when the worktree path is not a directory', () => {
    installTree()
    const spawn = vi.fn()

    scheduleSonarIndexWarmup({
      userDataDir,
      worktreePath: join(worktreePath, 'missing'),
      spawn,
      debug
    })

    expect(spawn).not.toHaveBeenCalled()
  })

  it('starts orca-sonar index for the worktree and does not wait for it', () => {
    const cliPath = installTree()
    const child = new FakeChild()
    const spawn = vi.fn((): FakeChild => child)

    const result = scheduleSonarIndexWarmup({ userDataDir, worktreePath, spawn, debug })

    expect(result).toBeUndefined()
    expect(spawn).toHaveBeenCalledWith(
      'node',
      [cliPath, 'index', '--warmup', '--root', worktreePath],
      expect.objectContaining({
        stdio: 'ignore',
        env: expect.objectContaining({ ORCA_USER_DATA_PATH: userDataDir })
      })
    )
    expect(child.unref).toHaveBeenCalled()
  })

  it('kills a run that outlives the timeout', () => {
    installTree()
    const child = new FakeChild()

    scheduleSonarIndexWarmup({
      userDataDir,
      worktreePath,
      spawn: (): FakeChild => child,
      debug
    })
    vi.advanceTimersByTime(SONAR_WARMUP_TIMEOUT_MS)

    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('does not kill a run that already exited', () => {
    installTree()
    const child = new FakeChild()

    scheduleSonarIndexWarmup({
      userDataDir,
      worktreePath,
      spawn: (): FakeChild => child,
      debug
    })
    child.emit('exit', 0, null)
    vi.advanceTimersByTime(SONAR_WARMUP_TIMEOUT_MS)

    expect(child.kill).not.toHaveBeenCalled()
  })

  it('logs at debug and does not throw when the process cannot start', () => {
    installTree()
    const spawn: SonarWarmupSpawn = () => {
      throw new Error('spawn node ENOENT')
    }

    expect(() =>
      scheduleSonarIndexWarmup({ userDataDir, worktreePath, spawn, debug })
    ).not.toThrow()
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('orca-sonar warm-up'),
      expect.any(Error)
    )
  })

  it('logs at debug when the started process reports an error', () => {
    installTree()
    const child = new FakeChild()

    scheduleSonarIndexWarmup({
      userDataDir,
      worktreePath,
      spawn: (): FakeChild => child,
      debug
    })
    child.emit('error', new Error('boom'))

    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('orca-sonar warm-up'),
      expect.any(Error)
    )
  })
})
