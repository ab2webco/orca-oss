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
      expect(options).toEqual({ detached: true, stdio: 'inherit' })
      expect(unrefMock).toHaveBeenCalledOnce()
    })

    // Runs the real script against real processes, so it needs a real /bin/sh.
    describe.skipIf(originalPlatform === 'win32')('the waiter script', () => {
      let actual: typeof ChildProcess
      const holders: ChildProcess.ChildProcess[] = []

      beforeEach(async () => {
        actual = await vi.importActual<typeof ChildProcess>('node:child_process')
      })

      afterEach(() => {
        holders.splice(0).forEach((child) => child.kill('SIGKILL'))
      })

      function waiterScript(): string {
        relaunchApp('admin-restart')
        return spawnMock.mock.calls[0][1][1] as string
      }

      function runWaiter(pid: number, timeout: number): Promise<{ output: string; ms: number }> {
        const startedAt = Date.now()
        return new Promise((resolve, reject) => {
          actual.execFile(
            '/bin/sh',
            ['-c', waiterScript(), 'orca-relaunch', String(pid), 'echo', 'a b'],
            { encoding: 'utf-8', timeout },
            (error, stdout) =>
              error ? reject(error) : resolve({ output: stdout, ms: Date.now() - startedAt })
          )
        })
      }

      // Why: an early exec fails the single-instance lock and exits, leaving no Orca.
      it('execs the same arguments only after the old pid exits', async () => {
        const old = actual.spawn('sleep', ['0.8'])
        holders.push(old)

        const { output, ms } = await runWaiter(old.pid!, 3_000)

        expect(output).toBe('a b\n')
        expect(ms).toBeGreaterThanOrEqual(700)
      })

      // Why: a zombie no longer holds the lock, and an unreaping parent would otherwise stall it forever.
      it.skipIf(originalPlatform !== 'linux')(
        'stops waiting once the old pid is a zombie',
        async () => {
          // The backgrounded sleep's parent becomes `sleep 30`, which never reaps it.
          const holder = actual.spawn('/bin/sh', ['-c', 'sleep 0.1 & echo $!; exec sleep 30'])
          holders.push(holder)
          const zombiePid = await new Promise<number>((resolve) =>
            holder.stdout!.once('data', (chunk) => resolve(Number(String(chunk).trim())))
          )

          await expect(runWaiter(zombiePid, 3_000)).resolves.toMatchObject({ output: 'a b\n' })
        }
      )
    })

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
