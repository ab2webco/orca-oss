import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export type ProcessRunState = 'running' | 'zombie' | 'gone'

function readProcessStatus(pid: number): string | null {
  if (process.platform === 'linux') {
    try {
      // Why: comm is parenthesised and may hold spaces or `)`; the state follows the last `)`.
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3)
    } catch {
      return null
    }
  }
  const ps = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })
  return ps.stdout.trim() || null
}

/**
 * Signal 0 succeeds on a zombie, so it reports a killed orphan as alive until its new parent
 * (init or a subreaper, never the test) reaps it — a wait no test can bound (ORCA-825).
 */
export function processRunState(pid: number): ProcessRunState {
  try {
    process.kill(pid, 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') {
      return 'gone'
    }
  }
  const status = readProcessStatus(pid)
  if (status === null) {
    return 'gone'
  }
  return status.startsWith('Z') ? 'zombie' : 'running'
}

/** One line naming a process and its parent, for an assertion message. */
export function describeProcessForFailure(pid: number): string {
  const read = (target: number): string =>
    spawnSync('ps', ['-o', 'ppid=,stat=,args=', '-p', String(target)], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' }
    }).stdout.trim()
  const self = read(pid)
  if (!self) {
    return `pid ${pid} is gone`
  }
  const parentPid = Number(self.split(/\s+/)[0])
  return `pid ${pid}: ${self} | parent ${parentPid}: ${read(parentPid) || 'gone'}`
}
