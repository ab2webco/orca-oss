import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CONVERGED,
  advancementSample,
  heartbeatLagVerdict,
  parkedHeartbeatBaseline,
  readHeartbeat
} from './inline-tui-heartbeat'

const MAX_VISIBLE_FRAME_LAG = 50

let directory: string | null = null

function heartbeatFile(contents: string | null): string {
  directory ??= mkdtempSync(path.join(tmpdir(), 'orca-inline-heartbeat-unit-'))
  const target = path.join(directory, `heartbeat-${Math.random().toString(36).slice(2)}.txt`)
  if (contents !== null) {
    writeFileSync(target, contents)
  }
  return target
}

afterEach(() => {
  if (directory) {
    rmSync(directory, { recursive: true, force: true })
    directory = null
  }
})

describe('readHeartbeat', () => {
  it('reports a truncated publish as unreadable rather than frame 0', () => {
    expect(readHeartbeat(heartbeatFile(''))).toEqual({ kind: 'unreadable', reason: 'empty' })
    expect(readHeartbeat(heartbeatFile(' \n'))).toEqual({ kind: 'unreadable', reason: 'empty' })
  })

  it('separates a missing file, malformed bytes and a real frame', () => {
    expect(readHeartbeat(heartbeatFile(null))).toEqual({ kind: 'unreadable', reason: 'missing' })
    expect(readHeartbeat(heartbeatFile('CODEX'))).toEqual({
      kind: 'unreadable',
      reason: 'malformed'
    })
    expect(readHeartbeat(heartbeatFile('482'))).toEqual({ kind: 'frame', frame: 482 })
  })
})

describe('heartbeatLagVerdict', () => {
  it('never reports convergence from an unreadable heartbeat', () => {
    // The vacuous pass: as frame 0 this compared 0 - 480 > 50, which is false.
    for (const reason of ['missing', 'empty', 'malformed'] as const) {
      expect(heartbeatLagVerdict(480, { kind: 'unreadable', reason }, MAX_VISIBLE_FRAME_LAG)).toBe(
        `heartbeat-unreadable ${reason}`
      )
    }
  })

  it('still converges on a live pane and still rejects a stale one', () => {
    expect(heartbeatLagVerdict(480, { kind: 'frame', frame: 500 }, MAX_VISIBLE_FRAME_LAG)).toBe(
      CONVERGED
    )
    expect(heartbeatLagVerdict(480, { kind: 'frame', frame: 600 }, MAX_VISIBLE_FRAME_LAG)).toBe(
      'stale-frame visible=480 live=600'
    )
    expect(heartbeatLagVerdict(-1, { kind: 'frame', frame: 500 }, MAX_VISIBLE_FRAME_LAG)).toBe(
      'stale-frame visible=-1 live=500'
    )
  })
})

describe('parkedHeartbeatBaseline', () => {
  it('refuses an unreadable baseline instead of yielding a threshold-clearing 0', async () => {
    await expect(parkedHeartbeatBaseline(heartbeatFile(''), 200)).rejects.toThrow(
      'parked heartbeat baseline unreadable (empty)'
    )
    await expect(parkedHeartbeatBaseline(heartbeatFile(null), 200)).rejects.toThrow(
      'parked heartbeat baseline unreadable (missing)'
    )
  })

  it('returns the published frame once one is readable', async () => {
    const target = heartbeatFile('')
    setTimeout(() => writeFileSync(target, '311'), 80)
    await expect(parkedHeartbeatBaseline(target, 3_000)).resolves.toBe(311)
  })
})

describe('advancementSample', () => {
  it('holds at the baseline for an unreadable sample so it cannot count as progress', () => {
    expect(advancementSample({ kind: 'unreadable', reason: 'empty' }, 400)).toBe(400)
    expect(advancementSample({ kind: 'frame', frame: 540 }, 400)).toBe(540)
  })
})
