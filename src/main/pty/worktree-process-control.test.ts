import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProcessRow } from './worktree-cwd-processes'
import { listWorktreeProcesses } from './worktree-process-control'

const UID = process.getuid?.() ?? 0
const STARTED = 'Tue Oct 27 08:05:00 2026'

function row(pid: number, ppid: number, extra: Partial<ProcessRow> = {}): ProcessRow {
  return { pid, ppid, pgid: pid, uid: UID, startedAt: STARTED, command: `proc-${pid}`, ...extra }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('listWorktreeProcesses', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'orca-678-wtp-'))
    dirs.push(dir)
    return realpathSync(dir)
  }

  function fakeDeps(root: string, table: ProcessRow[], insidePids: number[]) {
    return {
      platform: 'linux' as NodeJS.Platform,
      readCwds: async () => new Map(insidePids.map((pid) => [pid, join(root, 'src')])),
      readProcessRows: async () => ({ rows: table, capturedAtMs: Date.now() }),
      sendSignal: vi.fn(),
      selfPid: 900
    }
  }

  it('lists pid, ppid, command and cwd of every process inside the worktree', async () => {
    const root = tempRoot()
    const deps = fakeDeps(root, [row(1, 0), row(10, 1), row(11, 10), row(12, 1)], [10, 11])
    const result = await listWorktreeProcesses(root, { stop: false }, deps)
    expect(result).toEqual({
      supported: true,
      root,
      processes: [
        { pid: 10, ppid: 1, command: 'proc-10', cwd: join(root, 'src'), startedAt: STARTED },
        { pid: 11, ppid: 10, command: 'proc-11', cwd: join(root, 'src'), startedAt: STARTED }
      ],
      stopped: [],
      protected: []
    })
    expect(deps.sendSignal).not.toHaveBeenCalled()
  })

  it('stops them but refuses Orca itself, the caller, their ancestors and other users', async () => {
    const root = tempRoot()
    const table = [
      row(1, 0, { uid: 0 }),
      row(800, 1),
      row(900, 800),
      row(950, 1),
      row(951, 950),
      row(10, 1),
      row(11, 1, { uid: UID + 1 })
    ]
    const deps = fakeDeps(root, table, [800, 900, 950, 951, 10, 11])
    const result = await listWorktreeProcesses(root, { stop: true, callerPid: 951 }, deps)
    expect(result.supported && result.stopped).toEqual([10])
    expect(result.supported && result.protected.sort((a, b) => a - b)).toEqual([
      11, 800, 900, 950, 951
    ])
    expect(deps.sendSignal).toHaveBeenCalledWith(10, 'SIGTERM')
    expect(deps.sendSignal).toHaveBeenCalledTimes(1)
  })

  it('refuses to stop anything under home or the filesystem root', async () => {
    const root = tempRoot()
    const deps = { ...fakeDeps(root, [row(10, 1)], [10]), home: root }
    const result = await listWorktreeProcesses(root, { stop: true }, deps)
    expect(result).toEqual({
      supported: false,
      root,
      reason: `refusing to stop processes under ${root}: it contains the home folder`
    })
    expect(deps.sendSignal).not.toHaveBeenCalled()
  })

  it('reports Windows as unsupported', async () => {
    expect(await listWorktreeProcesses('C:\\w', { stop: true }, { platform: 'win32' })).toEqual({
      supported: false,
      root: 'C:\\w',
      reason: 'per-process cwd is not readable on Windows'
    })
  })

  it.skipIf(process.platform === 'win32' || spawnSync('sleep', ['0']).status !== 0)(
    'stops a real process whose cwd is inside the worktree',
    async () => {
      const root = tempRoot()
      const child = spawn('sleep', ['300'], { cwd: root, stdio: 'ignore', detached: true })
      const pid = child.pid ?? 0
      try {
        const listed = await listWorktreeProcesses(root, { stop: false })
        expect(listed.supported && listed.processes.map((p) => p.pid)).toContain(pid)
        const stopped = await listWorktreeProcesses(root, { stop: true })
        expect(stopped.supported && stopped.stopped).toContain(pid)
        const deadline = Date.now() + 10_000
        while (isAlive(pid) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        expect(isAlive(pid)).toBe(false)
      } finally {
        if (isAlive(pid)) {
          process.kill(pid, 'SIGKILL')
        }
      }
    },
    20_000
  )
})
