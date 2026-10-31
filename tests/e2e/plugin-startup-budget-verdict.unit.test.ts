import { describe, expect, it } from 'vitest'
import { evaluateStartupBudget } from './plugin-startup-budget-verdict'

const BUDGET_MS = 50
// Fitted from 60 real CI launches harvested from shard-12 report artifacts:
// pooled within-group spread of a single ready-to-show measurement.
const LAUNCH_SD_MS = 64
const BASE_MS = 1650
const SAMPLES = 16

// Deterministic normal samples, so a control that goes red does so for every
// reader and not just the machine that wrote it.
function launches(count: number, shiftMs: number, seed: number): number[] {
  let state = seed >>> 0
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return (state >>> 8) / 0x0100_0000
  }
  return Array.from({ length: count }, () => {
    const [u, v] = [Math.max(next(), 1e-12), next()]
    const gauss = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    return BASE_MS + shiftMs + gauss * LAUNCH_SD_MS
  })
}

function verdictFor(shiftMs: number, seed: number): boolean {
  return evaluateStartupBudget({
    baselineMs: launches(SAMPLES, 0, seed),
    populatedMs: launches(SAMPLES, shiftMs, seed + 7919),
    budgetMs: BUDGET_MS
  }).withinBudget
}

function redRate(shiftMs: number, rounds = 400): number {
  let red = 0
  for (let round = 0; round < rounds; round += 1) {
    if (!verdictFor(shiftMs, 1 + round * 31)) {
      red += 1
    }
  }
  return red / rounds
}

describe('evaluateStartupBudget', () => {
  it('reports the delta between the two means', () => {
    const verdict = evaluateStartupBudget({
      baselineMs: [1600, 1700],
      populatedMs: [1700, 1800],
      budgetMs: BUDGET_MS
    })
    expect(verdict.baselineMeanMs).toBe(1650)
    expect(verdict.populatedMeanMs).toBe(1750)
    expect(verdict.deltaMs).toBe(100)
    expect(verdict.withinBudget).toBe(false)
  })

  it('holds the budget exactly at the ceiling and fails one millisecond past it', () => {
    expect(
      evaluateStartupBudget({ baselineMs: [1600], populatedMs: [1650], budgetMs: BUDGET_MS })
        .withinBudget
    ).toBe(true)
    expect(
      evaluateStartupBudget({ baselineMs: [1600], populatedMs: [1651], budgetMs: BUDGET_MS })
        .withinBudget
    ).toBe(false)
  })

  it('refuses to judge an empty side rather than reporting a delta of NaN', () => {
    expect(() =>
      evaluateStartupBudget({ baselineMs: [], populatedMs: [1650], budgetMs: BUDGET_MS })
    ).toThrow('at least one sample')
  })

  // The control the estimator exists to pass: under the real per-launch spread,
  // a genuinely slower launch must still turn this red.
  it('catches a genuinely slow launch under real CI noise', () => {
    expect(redRate(75)).toBeGreaterThan(0.75)
    expect(redRate(100)).toBeGreaterThan(0.95)
    expect(redRate(150)).toBeGreaterThan(0.99)
  })

  // Run 40432819784 (ORCA-814): one populated launch stalled 1.8s in the
  // renderer after plugins had finished; the other 31 launches were level.
  it('does not let one stalled launch turn a level run red', () => {
    const verdict = evaluateStartupBudget({
      baselineMs: [
        1331, 1315, 1307, 1319, 1305, 1293, 1311, 1302, 1325, 1331, 1301, 1297, 1312, 1316, 1311,
        1319
      ],
      populatedMs: [
        1303, 1311, 3123, 1327, 1352, 1325, 1332, 1298, 1317, 1312, 1331, 1344, 1433, 1325, 1314,
        1330
      ],
      budgetMs: BUDGET_MS
    })
    expect(verdict.withinBudget, verdict.description).toBe(true)
  })

  it('stays green when any single launch per run stalls', () => {
    let red = 0
    for (let round = 0; round < 400; round += 1) {
      const populatedMs = launches(SAMPLES, 0, 1 + round * 31 + 7919)
      populatedMs[round % SAMPLES] += 1800
      const verdict = evaluateStartupBudget({
        baselineMs: launches(SAMPLES, 0, 1 + round * 31),
        populatedMs,
        budgetMs: BUDGET_MS
      })
      red += verdict.withinBudget ? 0 : 1
    }
    expect(red / 400).toBeLessThan(0.05)
  })

  it('does not fire on noise when the plugins cost nothing', () => {
    expect(redRate(0)).toBeLessThan(0.05)
    expect(redRate(25)).toBeLessThan(0.25)
  })
})
