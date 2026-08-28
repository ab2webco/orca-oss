import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)
const TOP_MAX_BUFFER = 8 * 1024 * 1024
const TOP_EXEC_TIMEOUT_MS = 5_000

/**
 * Why this metric exists next to RSS and never instead of it: macOS accounts a
 * process by phys_footprint — compressed and swapped pages included — and RSS
 * loses exactly those, so the gap widens as pressure rises. RSS still answers
 * "how do these processes compare"; footprint answers "what does the system
 * think we are using" (ORCA-325).
 *
 * Why `top` and not the `footprint` binary: `top -l 1 -stats pid,mem` reports
 * the same number — verified equal to `footprint -p <pid>` on live processes —
 * and sweeps every process in one ~0.7s call, where `footprint` costs that per
 * process.
 */
export type ProcessFootprintMetric = 'phys-footprint'

const UNIT_MULTIPLIERS: Record<string, number> = {
  B: 1,
  K: 1024,
  M: 1024 * 1024,
  G: 1024 * 1024 * 1024,
  T: 1024 * 1024 * 1024 * 1024
}

/** Exported for tests: parses `top -l 1 -stats pid,mem` into pid → bytes. */
export function parseTopFootprintOutput(stdout: string): Map<number, number> {
  const byPid = new Map<number, number>()
  for (const line of stdout.split('\n')) {
    // Why anchored on the two columns and not on a header offset: top prints a
    // banner whose line count changes with the machine, and a row that does not
    // match this shape is banner, not a process.
    const match = /^\s*(\d+)\s+([\d.]+)([BKMGT])(?:\+|-)?\s*$/.exec(line)
    if (!match) {
      continue
    }
    const pid = Number.parseInt(match[1], 10)
    const value = Number.parseFloat(match[2])
    const multiplier = UNIT_MULTIPLIERS[match[3]]
    if (!Number.isFinite(pid) || !Number.isFinite(value) || multiplier === undefined) {
      continue
    }
    byPid.set(pid, Math.round(value * multiplier))
  }
  return byPid
}

/** pid → phys_footprint bytes, or null where the platform has no equivalent. */
export async function collectMacFootprintByPid(
  platform: NodeJS.Platform = process.platform,
  deadlineMs: number = TOP_EXEC_TIMEOUT_MS
): Promise<Map<number, number> | null> {
  if (platform !== 'darwin') {
    return null
  }
  // Why a deadline here and not only exec's own timeout: this is the tool you
  // reach for while the machine is thrashing, which is exactly when a spawn is
  // slowest to come back — and a snapshot that hangs is a worse diagnostic than
  // one that reports null.
  let expire: NodeJS.Timeout | undefined
  const deadline = new Promise<null>((resolve) => {
    expire = setTimeout(() => resolve(null), deadlineMs)
    expire.unref?.()
  })
  try {
    const swept = await Promise.race([
      execAsync('top -l 1 -stats pid,mem', {
        maxBuffer: TOP_MAX_BUFFER,
        timeout: TOP_EXEC_TIMEOUT_MS,
        env: { ...process.env, LC_ALL: 'C', LANG: 'C' }
      }).then(({ stdout }) => parseTopFootprintOutput(stdout)),
      deadline
    ])
    // Why null and not an empty map: a sweep that returned nothing is a failed
    // measurement, and reporting it as zero bytes would read as an answer.
    return swept && swept.size > 0 ? swept : null
  } catch (err) {
    console.warn('[memory] phys_footprint sweep failed', err)
    return null
  } finally {
    clearTimeout(expire)
  }
}

/** Sum of the metric over `pids`, or null when the sweep is unavailable. */
export function sumFootprint(
  byPid: Map<number, number> | null,
  pids: Iterable<number>
): number | null {
  if (!byPid) {
    return null
  }
  let total = 0
  for (const pid of pids) {
    total += byPid.get(pid) ?? 0
  }
  return total
}
