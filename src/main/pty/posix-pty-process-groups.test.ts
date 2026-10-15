import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'

const { readFileSyncMock } = vi.hoisted(() => ({ readFileSyncMock: vi.fn() }))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFs>()),
  readFileSync: readFileSyncMock
}))

import {
  forceKillPosixPtyProcessGroups,
  getPosixPtyProcessGroups,
  parseLinuxProcStatSessionId
} from './posix-pty-process-groups'

// `/proc/<pid>/stat` fixture: fields after comm are state, ppid, pgrp, session, tty_nr, ...
const procStat = (pid: number, session: number, comm = 'bash'): string =>
  `${pid} (${comm}) S 1 ${pid} ${session} 34822 ${pid} 4194560 1 0 0 0 0 0 0 0 20 0 1 0 98765 0 0\n`
const procSessions = new Map<number, number>()

beforeEach(() => {
  procSessions.clear()
  readFileSyncMock.mockReset()
  // Default fixture: each hundred-block of pids is one terminal session led by its round pid.
  readFileSyncMock.mockImplementation((path: string) => {
    const pid = Number(/^\/proc\/(\d+)\/stat$/.exec(path)?.[1])
    if (!pid) {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }
    return procStat(pid, procSessions.get(pid) ?? Math.floor(pid / 100) * 100)
  })
})

const TABLE = `
  100  100 ttys001
  101  101 ttys001
  102  101 ttys001
  103  103 ttys001
  200  200 ttys002
  300  300 ??
`

describe('POSIX PTY process-group termination', () => {
  it('returns every group attached to the root PTY with the root group last', () => {
    expect(getPosixPtyProcessGroups(TABLE, 100, 999)).toEqual([101, 103, 100])
  })

  it('refuses an unbound root or a PTY shared with Orca Lab itself', () => {
    expect(getPosixPtyProcessGroups(TABLE, 300, 999)).toBeNull()
    expect(getPosixPtyProcessGroups(TABLE, 100, 102)).toBeNull()
    expect(getPosixPtyProcessGroups(TABLE, 999, 998)).toBeNull()
  })

  it('kills foreground and background groups before the PTY leader', () => {
    const fallback = vi.fn()
    const signalProcessGroup = vi.fn()

    forceKillPosixPtyProcessGroups(100, fallback, {
      platform: 'darwin',
      currentPid: 999,
      readProcessTable: () => TABLE,
      signalProcessGroup
    })

    expect(signalProcessGroup.mock.calls.map(([pgid]) => pgid)).toEqual([101, 103, 100])
    expect(fallback).not.toHaveBeenCalled()
  })

  it('falls back when the process table cannot prove PTY ownership', () => {
    const fallback = vi.fn()

    forceKillPosixPtyProcessGroups(100, fallback, {
      platform: 'linux',
      currentPid: 102,
      readProcessTable: () => TABLE,
      signalProcessGroup: vi.fn()
    })

    expect(fallback).toHaveBeenCalledOnce()
  })

  it('ignores groups that exited after the snapshot but preserves real signal errors', () => {
    const gone = Object.assign(new Error('gone'), { code: 'ESRCH' })
    const denied = Object.assign(new Error('denied'), { code: 'EPERM' })
    const signalProcessGroup = vi
      .fn<(pgid: number) => void>()
      .mockImplementationOnce(() => {
        throw gone
      })
      .mockImplementationOnce(() => {
        throw denied
      })

    expect(() =>
      forceKillPosixPtyProcessGroups(100, vi.fn(), {
        platform: 'darwin',
        currentPid: 999,
        readProcessTable: () => TABLE,
        signalProcessGroup
      })
    ).toThrow('denied')
    expect(signalProcessGroup).toHaveBeenCalledTimes(3)
  })

  it('uses the existing fallback on Windows without reading ps', () => {
    const fallback = vi.fn()
    const readProcessTable = vi.fn(() => TABLE)

    forceKillPosixPtyProcessGroups(100, fallback, {
      platform: 'win32',
      readProcessTable
    })

    expect(fallback).toHaveBeenCalledOnce()
    expect(readProcessTable).not.toHaveBeenCalled()
  })
})

describe('Linux terminal session identity (upstream #27422)', () => {
  // Container devpts instances reuse pts numbers: tty alone cannot tell host pts/6 from a container's.
  const COLLIDING_TABLE = `
100 100 pts/6
101 101 pts/6
500 500 pts/6
501 500 pts/6
600 600 pts/6
`

  it('parses the session id past a comm containing spaces and parentheses', () => {
    expect(parseLinuxProcStatSessionId(procStat(42, 7, 'evil) S 1 2 3 (x'))).toBe(7)
    expect(parseLinuxProcStatSessionId('42 (bash')).toBeNull()
    expect(parseLinuxProcStatSessionId('42 (bash) S 1 42')).toBeNull()
    expect(parseLinuxProcStatSessionId('42 (bash) S 1 42 0 0')).toBeNull()
  })

  it('force-kills only groups in the shell session, not container processes on the same pts', () => {
    procSessions.set(500, 500).set(501, 500).set(600, 600)
    const signalProcessGroup = vi.fn()
    const fallback = vi.fn()
    forceKillPosixPtyProcessGroups(100, fallback, {
      platform: 'linux',
      currentPid: 999,
      readProcessTable: () => COLLIDING_TABLE,
      signalProcessGroup
    })
    expect(signalProcessGroup.mock.calls).toEqual([[101], [100]])
    expect(fallback).not.toHaveBeenCalled()
    expect(readFileSyncMock).toHaveBeenCalledWith('/proc/500/stat', 'utf8')
  })

  it('excludes candidates whose session can no longer be read', () => {
    expect(
      getPosixPtyProcessGroups(COLLIDING_TABLE, 100, 999, (pid) =>
        pid === 101 ? null : pid < 200 ? 100 : pid
      )
    ).toEqual([100])
  })

  it.each([
    ['unreadable', () => null],
    ['not a session leader', () => 50]
  ])('falls back to the root-only kill when the shell session is %s', (_label, sessionOf) => {
    const signalProcessGroup = vi.fn()
    const fallback = vi.fn()
    forceKillPosixPtyProcessGroups(100, fallback, {
      platform: 'linux',
      currentPid: 999,
      readProcessTable: () => COLLIDING_TABLE,
      readProcessSessionId: sessionOf,
      signalProcessGroup
    })
    expect(fallback).toHaveBeenCalledOnce()
    expect(signalProcessGroup).not.toHaveBeenCalled()
  })

  it('keeps macOS selection by terminal alone without reading /proc', () => {
    const signalProcessGroup = vi.fn()
    forceKillPosixPtyProcessGroups(100, vi.fn(), {
      platform: 'darwin',
      currentPid: 999,
      readProcessTable: () => COLLIDING_TABLE,
      signalProcessGroup
    })
    expect(signalProcessGroup.mock.calls).toEqual([[101], [500], [600], [100]])
    expect(readFileSyncMock).not.toHaveBeenCalled()
  })
})
