import { describe, expect, it } from 'vitest'
import {
  collectMacFootprintByPid,
  parseTopFootprintOutput,
  sumFootprint
} from './mac-footprint-sweep'

// Shape taken from real `top -l 1 -stats pid,mem` output: a banner of varying
// height, then two columns.
const TOP_OUTPUT = `Processes: 619 total, 3 running, 616 sleeping
2026/08/28 20:30:00
Load Avg: 3.42, 4.10, 4.55
PhysMem: 15G used (2410M wired), 380M unused.
Disks: 81300797/1744G read, 41385863/835G written.

PID    MEM
99996  8160K
99993  8417K
99548  250M
7132   1066M
440    1.5G
12     512B
`

describe('parseTopFootprintOutput', () => {
  it('reads every unit top prints, as bytes', () => {
    const byPid = parseTopFootprintOutput(TOP_OUTPUT)
    expect(byPid.get(99996)).toBe(8160 * 1024)
    expect(byPid.get(99548)).toBe(250 * 1024 * 1024)
    expect(byPid.get(7132)).toBe(1066 * 1024 * 1024)
    expect(byPid.get(440)).toBe(Math.round(1.5 * 1024 * 1024 * 1024))
    expect(byPid.get(12)).toBe(512)
  })

  // Why asserted: the banner's height changes with the machine, so a parser that
  // counted header lines instead of matching the row shape would read a load
  // average as a process.
  it('takes only the rows, never the banner', () => {
    expect(parseTopFootprintOutput(TOP_OUTPUT).size).toBe(6)
  })
})

describe('collectMacFootprintByPid', () => {
  it('reports no metric off macOS rather than inventing one', async () => {
    await expect(collectMacFootprintByPid('linux')).resolves.toBeNull()
    await expect(collectMacFootprintByPid('win32')).resolves.toBeNull()
  })

  // Why this is a control and not a nicety: this sweep runs while the machine is
  // thrashing, which is when a spawn is slowest, and a snapshot that hangs is a
  // worse diagnostic than one that says it has no number.
  it('gives up on its own deadline instead of waiting for the shell-out', async () => {
    await expect(collectMacFootprintByPid('darwin', 0)).resolves.toBeNull()
  })
})

describe('sumFootprint', () => {
  it('adds only the pids asked for', () => {
    const byPid = parseTopFootprintOutput(TOP_OUTPUT)
    expect(sumFootprint(byPid, [99996, 12])).toBe(8160 * 1024 + 512)
  })

  // The distinction the whole metric rests on: unavailable is not zero. A zero
  // would read as "this app uses nothing" and compare as a real measurement.
  it('answers null when there is no sweep, not zero', () => {
    expect(sumFootprint(null, [1, 2, 3])).toBeNull()
  })

  it('counts a pid the sweep never saw as nothing, not as the whole sum missing', () => {
    const byPid = parseTopFootprintOutput(TOP_OUTPUT)
    expect(sumFootprint(byPid, [99996, 424242])).toBe(8160 * 1024)
  })
})
