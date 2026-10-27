import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isPathInside,
  isSweepableRoot,
  parseLsofCwds,
  parseProcessRows,
  scanCwdProcesses,
  selectSessionOrphans,
  type CwdProcessScan,
  type ProcessRow
} from './worktree-cwd-processes'

const UID = 501
const SESSION_START = Date.parse('Tue Oct 27 08:00:00 2026')
const AFTER = 'Tue Oct 27 08:05:00 2026'
const BEFORE = 'Tue Oct 27 07:55:00 2026'

function row(pid: number, ppid: number, extra: Partial<ProcessRow> = {}): ProcessRow {
  return { pid, ppid, pgid: pid, uid: UID, startedAt: AFTER, command: `proc-${pid}`, ...extra }
}

function scanOf(
  table: ProcessRow[],
  insidePids: number[]
): Extract<CwdProcessScan, { supported: true }> {
  return {
    supported: true,
    capturedAtMs: SESSION_START + 600_000,
    table,
    inside: table.filter((r) => insidePids.includes(r.pid)).map((r) => ({ ...r, cwd: '/w/t' }))
  }
}

function select(scan: Extract<CwdProcessScan, { supported: true }>, selfPid = 900): number[] {
  return selectSessionOrphans(scan, { notBeforeMs: SESSION_START, uid: UID, selfPid })
    .map((r) => r.pid)
    .sort((a, b) => a - b)
}

describe('parseProcessRows', () => {
  it('keeps lstart verbatim and the full command after it', () => {
    const rows = parseProcessRows(
      '  70285     1 70285   501 Tue Oct  7 08:37:00 2026 /bin/bash ./watch-pr-comments.sh --pr 12\n'
    )
    expect(rows).toEqual([
      {
        pid: 70285,
        ppid: 1,
        pgid: 70285,
        uid: 501,
        startedAt: 'Tue Oct  7 08:37:00 2026',
        command: '/bin/bash ./watch-pr-comments.sh --pr 12'
      }
    ])
  })
})

describe('parseLsofCwds', () => {
  it('maps each p block to its first n path', () => {
    expect(parseLsofCwds('p10\nfcwd\nn/w/t\np11\nfcwd\nn/other dir\n')).toEqual(
      new Map([
        [10, '/w/t'],
        [11, '/other dir']
      ])
    )
  })
})

describe('isPathInside / isSweepableRoot', () => {
  it('matches on a separator boundary only', () => {
    expect(isPathInside('/a/b/c', '/a/b')).toBe(true)
    expect(isPathInside('/a/b', '/a/b')).toBe(true)
    expect(isPathInside('/a/bc', '/a/b')).toBe(false)
  })

  it('refuses the filesystem root, home and its ancestors', () => {
    expect(isSweepableRoot('/', '/home/u')).toBe(false)
    expect(isSweepableRoot('/home/u', '/home/u')).toBe(false)
    expect(isSweepableRoot('/home', '/home/u')).toBe(false)
    expect(isSweepableRoot('/home/u/orca/workspaces/t', '/home/u')).toBe(true)
  })
})

describe('selectSessionOrphans', () => {
  it('selects a poller reparented to pid 1 and its children', () => {
    const table = [
      row(1, 0, { uid: 0 }),
      row(10, 1),
      row(11, 10),
      row(12, 11, { startedAt: AFTER })
    ]
    expect(select(scanOf(table, [10, 11]))).toEqual([10, 11, 12])
  })

  it('selects an orphan under the systemd --user subreaper', () => {
    const table = [
      row(1, 0, { uid: 0 }),
      row(5, 1, { startedAt: BEFORE, command: '/usr/lib/systemd/systemd --user' }),
      row(10, 5)
    ]
    expect(select(scanOf(table, [10]))).toEqual([10])
  })

  it('never selects a process that still has a live owner outside the set', () => {
    const table = [
      row(1, 0, { uid: 0 }),
      row(5, 1, { startedAt: BEFORE, command: '/Applications/Code.app/Code' }),
      row(10, 5),
      row(11, 10)
    ]
    expect(select(scanOf(table, [10, 11]))).toEqual([])
  })

  it('skips processes started before the session, owned by another user, or Orca itself', () => {
    const table = [
      row(1, 0, { uid: 0 }),
      row(10, 1, { startedAt: BEFORE }),
      row(11, 1, { uid: 0 }),
      row(900, 1),
      row(12, 1, { startedAt: 'not a date' })
    ]
    expect(select(scanOf(table, [10, 11, 900, 12]), 900)).toEqual([])
  })

  it('keeps a poller that ps reports up to a second before its real start (Linux lstart skew)', () => {
    // Why: Linux lstart is derived from a second-truncated boot time, so a poller that started
    // 0.3s after the session can read as 07:59:59 while the session started at 08:00:00.300.
    const sessionStart = Date.parse('Tue Oct 27 08:00:00 2026') + 300
    const table = [row(1, 0, { uid: 0 }), row(10, 1, { startedAt: 'Tue Oct 27 07:59:59 2026' })]
    const scan = scanOf(table, [10])
    expect(
      selectSessionOrphans(scan, { notBeforeMs: sessionStart, uid: UID, selfPid: 900 }).map(
        (r) => r.pid
      )
    ).toEqual([10])
  })

  it('does not hang on a cyclic-looking table from pid reuse', () => {
    const table = [row(10, 11), row(11, 10)]
    expect(select(scanOf(table, [10, 11]))).toEqual([])
  })
})

describe('scanCwdProcesses', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports Windows as unsupported instead of an empty list', async () => {
    expect(await scanCwdProcesses('C:\\w', { platform: 'win32' })).toEqual({
      supported: false,
      reason: 'per-process cwd is not readable on Windows'
    })
  })

  it('joins cwds to process rows against the realpath of the root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-cwd-scan-'))
    dirs.push(dir)
    const real = realpathSync(dir)
    const scan = await scanCwdProcesses(dir, {
      platform: 'darwin',
      readCwds: async () =>
        new Map([
          [10, join(real, 'sub')],
          [11, `${real}-sibling`]
        ]),
      readProcessRows: async () => ({ rows: [row(10, 1), row(11, 1)], capturedAtMs: 1 })
    })
    expect(scan.supported && scan.inside.map((r) => r.pid)).toEqual([10])
  })

  it('reports a failed cwd read as unsupported', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-cwd-scan-'))
    dirs.push(dir)
    const scan = await scanCwdProcesses(dir, {
      platform: 'darwin',
      readCwds: async () => {
        throw new Error('lsof timed out')
      },
      readProcessRows: async () => ({ rows: [], capturedAtMs: 1 })
    })
    expect(scan).toEqual({ supported: false, reason: 'lsof timed out' })
  })
})
