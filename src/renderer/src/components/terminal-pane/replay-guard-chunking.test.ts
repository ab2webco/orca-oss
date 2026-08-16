import { describe, expect, it } from 'vitest'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import { TERMINAL_WRITE_CHUNK_CHARS } from '@/lib/pane-manager/terminal-write-chunk-size'
import { isPaneReplaying, replayIntoTerminal, type ReplayingPanesRef } from './replay-guard'

type QueuedWrite = { data: string; parse: (() => void) | undefined }

function createReplayHarness(): {
  pane: ManagedPane
  replayingPanesRef: ReplayingPanesRef
  writes: QueuedWrite[]
} {
  const writes: QueuedWrite[] = []
  const terminal = {
    rows: 24,
    buffer: { active: { baseY: 0, viewportY: 0, cursorY: 0 } },
    write(data: string, callback?: () => void): void {
      writes.push({ data, parse: callback })
    }
  }
  return {
    pane: { id: 7, leafId: 'leaf-7', terminal } as unknown as ManagedPane,
    replayingPanesRef: { current: new Map<number, number>() },
    writes
  }
}

/** Everything xterm was handed, in the order it was handed. */
function writtenData(writes: QueuedWrite[]): string {
  return writes.map((write) => write.data).join('')
}

describe('replay chunking', () => {
  it('splits a large replay into chunks xterm can yield between, in order', () => {
    const { pane, replayingPanesRef, writes } = createReplayHarness()
    // Deliberately not a multiple of the chunk size, so the tail is its own write.
    const replay = Array.from({ length: 40 }, (_, index) =>
      String.fromCharCode(97 + (index % 26)).repeat(1024)
    ).join('')

    replayIntoTerminal(pane, replayingPanesRef, replay)

    expect(writes.length).toBe(Math.ceil(replay.length / TERMINAL_WRITE_CHUNK_CHARS))
    for (const write of writes) {
      expect(write.data.length).toBeLessThanOrEqual(TERMINAL_WRITE_CHUNK_CHARS)
    }
    // Order and content: a reordered or lossy split repaints the wrong screen.
    expect(writtenData(writes)).toBe(replay)
  })

  it('holds the guard until the last chunk parses', () => {
    const { pane, replayingPanesRef, writes } = createReplayHarness()
    const replay = 'x'.repeat(TERMINAL_WRITE_CHUNK_CHARS * 3)

    replayIntoTerminal(pane, replayingPanesRef, replay)
    expect(writes.length).toBe(3)
    expect(isPaneReplaying(replayingPanesRef, pane.id)).toBe(true)

    // Why this is the assertion that matters: if the guard released on the first
    // chunk, xterm's auto-replies to queries in the chunks still being parsed
    // would reach the shell — the leak the guard exists to stop.
    for (const write of writes.slice(0, -1)) {
      write.parse?.()
      expect(isPaneReplaying(replayingPanesRef, pane.id)).toBe(true)
    }

    writes.at(-1)?.parse?.()
    expect(isPaneReplaying(replayingPanesRef, pane.id)).toBe(false)
  })

  it('releases the guard when a chunk is rejected mid-replay', () => {
    const writes: QueuedWrite[] = []
    let accepted = 0
    const terminal = {
      rows: 24,
      buffer: { active: { baseY: 0, viewportY: 0, cursorY: 0 } },
      write(data: string, callback?: () => void): void {
        accepted += 1
        if (accepted === 2) {
          throw new Error('terminal disposed mid-replay')
        }
        writes.push({ data, parse: callback })
      }
    }
    const pane = { id: 9, leafId: 'leaf-9', terminal } as unknown as ManagedPane
    const replayingPanesRef: ReplayingPanesRef = { current: new Map<number, number>() }

    replayIntoTerminal(pane, replayingPanesRef, 'y'.repeat(TERMINAL_WRITE_CHUNK_CHARS * 3))

    // The last chunk never gets written, so the guard has to come off the
    // failure path instead of waiting out the stall probe.
    expect(accepted).toBe(2)
    expect(isPaneReplaying(replayingPanesRef, pane.id)).toBe(false)
  })

  it('leaves a replay under the chunk size as a single write', () => {
    const { pane, replayingPanesRef, writes } = createReplayHarness()
    const replay = 'z'.repeat(TERMINAL_WRITE_CHUNK_CHARS)

    replayIntoTerminal(pane, replayingPanesRef, replay)

    expect(writes.length).toBe(1)
    expect(writes[0]?.data).toBe(replay)
    expect(isPaneReplaying(replayingPanesRef, pane.id)).toBe(true)
    writes[0]?.parse?.()
    expect(isPaneReplaying(replayingPanesRef, pane.id)).toBe(false)
  })
})
