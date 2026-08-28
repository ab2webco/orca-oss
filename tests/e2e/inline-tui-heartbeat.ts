import { readFileSync } from 'node:fs'

// Why a discriminated result: an unreadable heartbeat used to collapse into the
// same numeric channel as a real frame, so "no reading" compared as frame 0 and
// silently satisfied both the lag and the advancement checks.
export type HeartbeatReading =
  | { readonly kind: 'frame'; readonly frame: number }
  | { readonly kind: 'unreadable'; readonly reason: 'missing' | 'empty' | 'malformed' }

export const CONVERGED = 'converged'

export function readHeartbeat(heartbeatPath: string): HeartbeatReading {
  let raw: string
  try {
    raw = readFileSync(heartbeatPath, 'utf8')
  } catch {
    return { kind: 'unreadable', reason: 'missing' }
  }
  const text = raw.trim()
  if (text === '') {
    return { kind: 'unreadable', reason: 'empty' }
  }
  if (!/^\d+$/.test(text)) {
    return { kind: 'unreadable', reason: 'malformed' }
  }
  return { kind: 'frame', frame: Number(text) }
}

export function heartbeatLagVerdict(
  visibleFrame: number,
  heartbeat: HeartbeatReading,
  maxLag: number
): string {
  if (heartbeat.kind !== 'frame') {
    return `heartbeat-unreadable ${heartbeat.reason}`
  }
  if (visibleFrame < 0 || heartbeat.frame - visibleFrame > maxLag) {
    return `stale-frame visible=${visibleFrame} live=${heartbeat.frame}`
  }
  return CONVERGED
}

// Why the baseline blocks instead of defaulting: a substituted 0 makes the
// advancement threshold already true, retiring the liveness check entirely.
export async function parkedHeartbeatBaseline(
  heartbeatPath: string,
  timeoutMs = 5_000
): Promise<number> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const reading = readHeartbeat(heartbeatPath)
    if (reading.kind === 'frame') {
      return reading.frame
    }
    if (Date.now() >= deadline) {
      throw new Error(`parked heartbeat baseline unreadable (${reading.reason})`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

// Why the baseline is the fallback: an unreadable sample must never be counted
// as progress by the advancement poll.
export function advancementSample(reading: HeartbeatReading, baseline: number): number {
  return reading.kind === 'frame' ? reading.frame : baseline
}
