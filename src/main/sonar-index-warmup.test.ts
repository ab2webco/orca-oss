import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  SONAR_WARMUP_TIMEOUT_MS,
  isSonarPluginActive,
  scheduleSonarIndexWarmup,
  type ScheduleSonarIndexWarmupOptions,
  type SonarWarmupSpawn
} from './sonar-index-warmup'

const HASH = 'd'.repeat(64)

class FakeChild extends EventEmitter {
  readonly kill = vi.fn(() => true)
  readonly unref = vi.fn()
}

describe('isSonarPluginActive', () => {
  it('is active only while Orca grants the plugin its capabilities', () => {
    const granted = vi.fn((key: string) => (key === 'ab2web.orca-sonar' ? [] : null))

    expect(isSonarPluginActive({ getGrantedCapabilities: granted })).toBe(true)
    expect(isSonarPluginActive({ getGrantedCapabilities: () => null })).toBe(false)
    expect(isSonarPluginActive(null)).toBe(false)
  })
})

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

  function warm(options: Partial<ScheduleSonarIndexWarmupOptions> = {}): void {
    scheduleSonarIndexWarmup({
      userDataDir,
      worktreePath,
      debug,
      isPluginActive: () => true,
      ...options
    })
  }

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

    warm({ spawn })

    expect(spawn).not.toHaveBeenCalled()
  })

  it('does not run the plugin while Orca has it disabled, pending consent or switched off', () => {
    installTree()
    const spawn = vi.fn()

    warm({ spawn, isPluginActive: () => false })

    expect(spawn).not.toHaveBeenCalled()
  })

  it('does not run the plugin when Orca cannot say whether it is active', () => {
    installTree()
    const spawn = vi.fn()

    warm({
      spawn,
      isPluginActive: () => {
        throw new Error('plugin service gone')
      }
    })

    expect(spawn).not.toHaveBeenCalled()
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('orca-sonar warm-up'),
      expect.any(Error)
    )
  })

  it('does nothing when the worktree path is not a directory', () => {
    installTree()
    const spawn = vi.fn()

    warm({ worktreePath: join(worktreePath, 'missing'), spawn })

    expect(spawn).not.toHaveBeenCalled()
  })

  it('starts orca-sonar index for the worktree and does not wait for it', () => {
    const cliPath = installTree()
    const child = new FakeChild()
    const spawn = vi.fn((): FakeChild => child)

    const result = scheduleSonarIndexWarmup({
      userDataDir,
      worktreePath,
      spawn,
      debug,
      isPluginActive: () => true
    })

    expect(result).toBeUndefined()
    expect(spawn).toHaveBeenCalledWith(
      'node',
      [cliPath, 'index', '--root', worktreePath],
      expect.objectContaining({
        stdio: 'ignore',
        env: expect.objectContaining({ ORCA_USER_DATA_PATH: userDataDir })
      })
    )
    expect(child.unref).toHaveBeenCalled()
  })

  it('marks the run as a warm-up through the environment, not a flag', () => {
    installTree()
    const spawn = vi.fn((): FakeChild => new FakeChild())

    warm({ spawn })

    expect(spawn).toHaveBeenCalledWith(
      'node',
      expect.not.arrayContaining(['--warmup']),
      expect.objectContaining({
        env: expect.objectContaining({ ORCA_SONAR_WARMUP: '1' })
      })
    )
  })

  it('kills a run that outlives the timeout', () => {
    installTree()
    const child = new FakeChild()

    warm({ spawn: (): FakeChild => child })
    vi.advanceTimersByTime(SONAR_WARMUP_TIMEOUT_MS)

    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('does not kill a run that already exited', () => {
    installTree()
    const child = new FakeChild()

    warm({ spawn: (): FakeChild => child })
    child.emit('exit', 0, null)
    vi.advanceTimersByTime(SONAR_WARMUP_TIMEOUT_MS)

    expect(child.kill).not.toHaveBeenCalled()
  })

  it('logs at debug and does not throw when the process cannot start', () => {
    installTree()
    const spawn: SonarWarmupSpawn = () => {
      throw new Error('spawn node ENOENT')
    }

    expect(() => warm({ spawn })).not.toThrow()
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('orca-sonar warm-up'),
      expect.any(Error)
    )
  })

  it('logs at debug when the started process reports an error', () => {
    installTree()
    const child = new FakeChild()

    warm({ spawn: (): FakeChild => child })
    child.emit('error', new Error('boom'))

    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('orca-sonar warm-up'),
      expect.any(Error)
    )
  })
})
