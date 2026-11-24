import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ChildProcess from 'node:child_process'

const { appRelaunchMock, recordDurableCrashBreadcrumbMock, spawnMock, unrefMock, onMock } =
  vi.hoisted(() => ({
    appRelaunchMock: vi.fn(),
    recordDurableCrashBreadcrumbMock: vi.fn(),
    spawnMock: vi.fn(),
    unrefMock: vi.fn(),
    onMock: vi.fn()
  }))

vi.mock('electron', () => ({ app: { relaunch: appRelaunchMock } }))
vi.mock('node:child_process', () => ({ spawn: spawnMock }))
vi.mock('./crash-reporting/durable-crash-breadcrumb', () => ({
  recordDurableCrashBreadcrumb: recordDurableCrashBreadcrumbMock
}))

import { relaunchApp } from './app-relaunch'

const originalPlatform = process.platform
const originalArgv = process.argv

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

beforeEach(() => {
  appRelaunchMock.mockReset()
  recordDurableCrashBreadcrumbMock.mockReset()
  spawnMock.mockReset()
  unrefMock.mockReset()
  onMock.mockReset()
  spawnMock.mockReturnValue({ unref: unrefMock, on: onMock })
  setPlatform('darwin')
})

afterEach(() => {
  setPlatform(originalPlatform)
  process.argv = originalArgv
  vi.unstubAllEnvs()
})

describe('relaunchApp', () => {
  it('durably records the reason before scheduling the replacement process', () => {
    relaunchApp('gpu-fallback', { processReason: 'crashed', exitCode: 5 })

    expect(recordDurableCrashBreadcrumbMock).toHaveBeenCalledOnce()
    expect(recordDurableCrashBreadcrumbMock).toHaveBeenCalledWith('app_relaunch_requested', {
      processReason: 'crashed',
      exitCode: 5,
      reason: 'gpu-fallback'
    })
    expect(appRelaunchMock).toHaveBeenCalledOnce()
    expect(recordDurableCrashBreadcrumbMock.mock.invocationCallOrder[0]).toBeLessThan(
      appRelaunchMock.mock.invocationCallOrder[0]
    )
  })

  it('uses Electron relaunch outside Linux', () => {
    setPlatform('win32')
    relaunchApp('admin-restart')

    expect(appRelaunchMock).toHaveBeenCalledOnce()
    expect(spawnMock).not.toHaveBeenCalled()
  })

  describe('on Linux', () => {
    beforeEach(() => {
      setPlatform('linux')
      vi.stubEnv('APPIMAGE', '')
      process.argv = [process.execPath, '--profile=work', 'orca://open']
    })

    // Why: Electron's relauncher sets no_new_privs, so the next update's pkexec exits 127.
    it('never uses Electron relaunch, whose relauncher sets no_new_privs', () => {
      relaunchApp('update-install')

      expect(appRelaunchMock).not.toHaveBeenCalled()
      expect(recordDurableCrashBreadcrumbMock).toHaveBeenCalledWith('app_relaunch_requested', {
        reason: 'update-install'
      })
    })

    it('starts a detached shell that waits for this process, then execs the same command line', () => {
      relaunchApp('admin-restart')

      expect(spawnMock).toHaveBeenCalledOnce()
      const [command, args, options] = spawnMock.mock.calls[0]
      expect(command).toBe('/bin/sh')
      expect(args[0]).toBe('-c')
      expect(args.slice(2)).toEqual([
        'orca-relaunch',
        String(process.pid),
        process.execPath,
        '--profile=work',
        'orca://open'
      ])
      expect(options).toEqual({ detached: true, stdio: 'ignore' })
      expect(unrefMock).toHaveBeenCalledOnce()
    })

    // Runs the real script, so it needs a real /bin/sh.
    it.skipIf(originalPlatform === 'win32')(
      'runs a script that waits for the pid, bounded, before exec',
      async () => {
        relaunchApp('admin-restart')
        const script = spawnMock.mock.calls[0][1][1] as string

        // Executes the real script with a dead pid and `echo` as the program.
        const { execFileSync } = await vi.importActual<typeof ChildProcess>('node:child_process')
        const output = execFileSync(
          '/bin/sh',
          ['-c', script, 'orca-relaunch', '2147483646', 'echo', 'a b'],
          {
            encoding: 'utf-8'
          }
        )
        expect(output).toBe('a b\n')
        expect(script).toMatch(/kill -0 "\$1"/)
        expect(script).toMatch(/-lt \d+/)
      }
    )

    it('falls back to Electron relaunch when the shell cannot start', () => {
      spawnMock.mockImplementation(() => {
        throw new Error('EAGAIN')
      })

      relaunchApp('admin-restart')

      expect(appRelaunchMock).toHaveBeenCalledOnce()
    })

    it('keeps Electron relaunch for an AppImage, whose mount vanishes with this process', () => {
      vi.stubEnv('APPIMAGE', '/home/u/Orca.AppImage')

      relaunchApp('admin-restart')

      expect(appRelaunchMock).toHaveBeenCalledOnce()
      expect(spawnMock).not.toHaveBeenCalled()
    })
  })
})
