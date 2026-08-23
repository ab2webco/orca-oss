// What it costs to put a terminal in every grid cell (ORCA-234).
//
// Two candidates were on the table: read the plain-text tail out of the
// emulator main ALREADY keeps per pty, or stand a terminal up per cell (a
// renderer xterm, or a headless parser feeding one). This measures both at a
// realistic cell count so the choice rests on a number.
//
// Opt-in like its sibling benchmarks — wall-clock assertions belong in a run
// someone asked for, not in every CI shard:
//   ORCA_TERMINAL_PERF_BENCH=1 npx vitest run --config config/vitest.config.ts \
//     src/main/ipc/agent-terminal-tail.bench.test.ts

import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { HeadlessEmulator } from '../daemon/headless-emulator'

const benchEnabled = process.env.ORCA_TERMINAL_PERF_BENCH === '1'
/** A full pop-out of agents; the grid caps a batch at 32. */
const CELLS = 12
const SAMPLES = 200
const COLS = 160
const ROWS = 48
const TAIL_LINES = 8

/** Stand-in for an agent TUI: colour, cursor moves, box drawing, a redraw. */
function agentFrame(tick: number): string {
  const rows = Array.from(
    { length: 12 },
    (_, index) =>
      `\x1b[38;5;${33 + (index % 6)}m│\x1b[0m tool ${index} · tick ${tick} ` +
      `\x1b[2m${'·'.repeat(60)}\x1b[0m\r\n`
  )
  return `\x1b[H${rows.join('')}\x1b[1m● Running\x1b[0m tick ${tick}\r\n`
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

function summarize(samples: number[]): { p50: number; p95: number } {
  const sorted = [...samples].sort((a, b) => a - b)
  return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) }
}

function nonBlank(lines: string[]): string[] {
  return lines.map((line) => line.trimEnd()).filter((line) => line.trim().length > 0)
}

describe.skipIf(!benchEnabled)('agent terminal tail cost', () => {
  it('compares reading the live buffer against a terminal per cell', async () => {
    const emulators = Array.from(
      { length: CELLS },
      () => new HeadlessEmulator({ cols: COLS, rows: ROWS, scrollback: 1000 })
    )
    try {
      for (let tick = 0; tick < 40; tick += 1) {
        await Promise.all(emulators.map((emulator) => emulator.write(agentFrame(tick))))
      }

      // (A) The shipped path: read the buffer main already maintains.
      const liveReadSamples: number[] = []
      for (let sample = 0; sample < SAMPLES; sample += 1) {
        const started = performance.now()
        for (const emulator of emulators) {
          nonBlank(emulator.getVisibleLines()).slice(-TAIL_LINES)
        }
        liveReadSamples.push(performance.now() - started)
      }

      // (B) The floor for a terminal per cell: parse each pty's serialized
      // screen into a terminal of its own. A real xterm pays this AND its DOM.
      const snapshots = emulators.map((emulator) => emulator.getSnapshot({ scrollbackRows: 0 }))
      const perCellTerminalSamples: number[] = []
      for (let sample = 0; sample < SAMPLES / 10; sample += 1) {
        const started = performance.now()
        for (const snapshot of snapshots) {
          const parser = new HeadlessEmulator({
            cols: snapshot.cols,
            rows: snapshot.rows,
            scrollback: 0
          })
          await parser.write(snapshot.snapshotAnsi)
          nonBlank(parser.getVisibleLines()).slice(-TAIL_LINES)
          parser.dispose()
        }
        perCellTerminalSamples.push(performance.now() - started)
      }

      const liveRead = summarize(liveReadSamples)
      const perCellTerminal = summarize(perCellTerminalSamples)
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            cells: CELLS,
            tailLines: TAIL_LINES,
            liveBufferReadMsPerTick: liveRead,
            liveBufferReadMsPerCell: {
              p50: liveRead.p50 / CELLS,
              p95: liveRead.p95 / CELLS
            },
            terminalPerCellMsPerTick: perCellTerminal,
            terminalPerCellMsPerCell: {
              p50: perCellTerminal.p50 / CELLS,
              p95: perCellTerminal.p95 / CELLS
            }
          },
          null,
          2
        )
      )
      expect(liveRead.p50).toBeLessThan(perCellTerminal.p50)
    } finally {
      for (const emulator of emulators) {
        emulator.dispose()
      }
    }
  })
})
