import os from 'node:os'

export type CpuTimes = { busy: number; total: number }

// Why: a read 15 s after the last one measures those 15 s; a gap this long no longer says "now".
const STALE_MS = 60_000
const FIRST_WINDOW_MS = 250

export function cpuTimesOf(cpus: readonly os.CpuInfo[]): CpuTimes {
  let busy = 0
  let total = 0
  for (const { times } of cpus) {
    const all = (times?.user ?? 0) + (times?.nice ?? 0) + (times?.sys ?? 0) + (times?.irq ?? 0)
    busy += all
    total += all + (times?.idle ?? 0)
  }
  return { busy, total }
}

/** Percent of every core busy between two samples; none when the counters did not move forward. */
export function cpuUsagePercentOf(before: CpuTimes, after: CpuTimes): number | undefined {
  const total = after.total - before.total
  const busy = after.busy - before.busy
  if (!(total > 0) || busy < 0) {
    return undefined
  }
  return Math.min(100, Math.round((busy / total) * 100))
}

export function createHostCpuUsage({
  sample = () => cpuTimesOf(os.cpus()),
  now = Date.now,
  wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
}: {
  sample?: () => CpuTimes
  now?: () => number
  wait?: (ms: number) => Promise<void>
} = {}): () => Promise<number | undefined> {
  let last: { at: number; times: CpuTimes } | null = null
  return async () => {
    let before = last
    if (!before || now() - before.at > STALE_MS) {
      before = { at: now(), times: sample() }
      await wait(FIRST_WINDOW_MS)
    }
    const times = sample()
    last = { at: now(), times }
    return cpuUsagePercentOf(before.times, times)
  }
}

export const readHostCpuUsage = createHostCpuUsage()
