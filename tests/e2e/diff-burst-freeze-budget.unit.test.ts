import { describe, expect, it } from 'vitest'
import {
  BURST_FREEZE_CEILING_MS,
  BURST_P95_ALLOWANCE_MS,
  evaluateDiffBurstBudget
} from './diff-burst-freeze-budget'

// The spec passes these exact constants; a control tuned to its own copies
// would not be testing the assertion the suite actually makes (ORCA-319).
const P95_ALLOWANCE_MS = BURST_P95_ALLOWANCE_MS
const FREEZE_CEILING_MS = BURST_FREEZE_CEILING_MS

function verdict(over: Partial<Parameters<typeof evaluateDiffBurstBudget>[0]> = {}) {
  return evaluateDiffBurstBudget({
    baselineP95Ms: 5,
    burstP95Ms: 5,
    burstMaxLagMs: 2_234,
    burstSampleCount: 326,
    expectedSampleCount: 360,
    p95AllowanceMs: P95_ALLOWANCE_MS,
    freezeCeilingMs: FREEZE_CEILING_MS,
    ...over
  })
}

// The statistic this replaces: peak measured against the idle window's own peak.
function oldStatisticPasses(baselineMaxLagMs: number, burstMaxLagMs: number): boolean {
  return burstMaxLagMs <= Math.max(baselineMaxLagMs, 100) + 1_000
}

describe('evaluateDiffBurstBudget', () => {
  it('accepts a healthy burst', () => {
    expect(verdict().kind).toBe('within-budget')
  })

  it('holds at the p95 ceiling and fails one millisecond past it', () => {
    expect(verdict({ baselineP95Ms: 5, burstP95Ms: 5 + P95_ALLOWANCE_MS }).kind).toBe(
      'within-budget'
    )
    expect(verdict({ baselineP95Ms: 5, burstP95Ms: 5 + P95_ALLOWANCE_MS + 0.1 }).kind).toBe(
      'sustained-blocking'
    )
  })

  it('holds at the freeze ceiling and fails one millisecond past it', () => {
    expect(verdict({ burstMaxLagMs: FREEZE_CEILING_MS }).kind).toBe('within-budget')
    expect(verdict({ burstMaxLagMs: FREEZE_CEILING_MS + 0.1 }).kind).toBe('freeze')
  })

  it('catches the recorded STA-3420 signature by p95', () => {
    // The regression reported p95 3963ms and 16 samples in 23s against 360.
    const result = verdict({ baselineP95Ms: 0.1, burstP95Ms: 3_963, burstSampleCount: 16 })
    expect(result.kind).toBe('sustained-blocking')
    expect(result.kind !== 'within-budget' && result.reason).toContain('3963.0ms')
  })

  it('catches the same signature by sample coverage even if p95 were healthy', () => {
    // Two independent detectors, so neither carries the regression alone.
    const result = verdict({ baselineP95Ms: 0.1, burstP95Ms: 1, burstSampleCount: 16 })
    expect(result.kind).toBe('starved-sampler')
    expect(result.kind !== 'within-budget' && result.reason).toContain('16 of 360')
  })

  // A known and accepted limit, written down rather than discovered later: the
  // peak clause is a catastrophic-freeze detector, not a regression detector.
  // The commit that fixed STA-3420 measured that the peak "reproduces identically
  // with invalidation disabled" (034fa50970), so it never had this sensitivity.
  it('does NOT fire on a 5s peak with a healthy p95 and full coverage', () => {
    expect(verdict({ burstMaxLagMs: 5_000, burstP95Ms: 1, burstSampleCount: 326 }).kind).toBe(
      'within-budget'
    )
    // What would have to be true for the peak clause to be the one that fires.
    expect(verdict({ burstMaxLagMs: 12_000, burstP95Ms: 1, burstSampleCount: 326 }).kind).toBe(
      'freeze'
    )
  })

  // The discriminator: the same near-ceiling inputs, judged by the statistic
  // this replaces. If the old one also fails them, nothing was gained.
  it('gains power the old peak-versus-peak statistic did not have', () => {
    const baselineP95Ms = 0.1
    const burstP95Ms = 3_963
    const burstMaxLagMs = 4_000

    expect(verdict({ baselineP95Ms, burstP95Ms, burstMaxLagMs }).kind).toBe('sustained-blocking')
    // A stall in the idle window lifts the old ceiling to 11 620ms, so the old
    // statistic passes the very blocking this spec was written to catch.
    expect(oldStatisticPasses(10_620, burstMaxLagMs)).toBe(true)
  })

  it('no longer depends on whether a stall landed in the idle window', () => {
    // The two CI shapes: a clean idle window and one that caught a stall.
    for (const baselineMaxLagMs of [243, 12_109]) {
      expect(verdict({ burstMaxLagMs: 2_106 }).kind).toBe('within-budget')
      // The old statistic gave opposite answers for the same burst.
      expect(oldStatisticPasses(baselineMaxLagMs, 2_106)).toBe(baselineMaxLagMs > 1_106)
    }
  })
})

// Every harvested CI run of this spec, judged by both statistics.
describe('the sixteen CI runs this was derived from', () => {
  const RUNS: readonly {
    baselineMax: number
    baselineP95: number
    burstMax: number
    burstP95: number
  }[] = [
    { baselineMax: 11618, baselineP95: 26.3, burstMax: 2511, burstP95: 0.6 },
    { baselineMax: 732, baselineP95: 0.2, burstMax: 390, burstP95: 2.4 },
    { baselineMax: 243, baselineP95: 0.1, burstMax: 2106, burstP95: 7.4 },
    { baselineMax: 12082, baselineP95: 178.5, burstMax: 2654, burstP95: 0.4 },
    { baselineMax: 12109, baselineP95: 0.1, burstMax: 2362, burstP95: 0.6 },
    { baselineMax: 8528, baselineP95: 3.5, burstMax: 2517, burstP95: 0.2 },
    { baselineMax: 11810, baselineP95: 13.2, burstMax: 2428, burstP95: 0.2 },
    { baselineMax: 11846, baselineP95: 8.8, burstMax: 2628, burstP95: 0.2 },
    { baselineMax: 661, baselineP95: 1.1, burstMax: 1327, burstP95: 2.5 },
    { baselineMax: 341, baselineP95: 1.2, burstMax: 410, burstP95: 0.4 },
    { baselineMax: 10420, baselineP95: 1.9, burstMax: 5, burstP95: 0.2 },
    { baselineMax: 10612, baselineP95: 9.8, burstMax: 5074, burstP95: 0.3 },
    { baselineMax: 10641, baselineP95: 144.6, burstMax: 2705, burstP95: 0.2 },
    { baselineMax: 317, baselineP95: 0.1, burstMax: 882, burstP95: 2.4 },
    { baselineMax: 586, baselineP95: 0.8, burstMax: 354, burstP95: 0.4 },
    { baselineMax: 564, baselineP95: 0.4, burstMax: 370, burstP95: 2.6 }
  ]

  it('accepts all sixteen, where the old statistic rejected the fastest of them', () => {
    for (const run of RUNS) {
      expect(
        verdict({
          baselineP95Ms: run.baselineP95,
          burstP95Ms: run.burstP95,
          burstMaxLagMs: run.burstMax
        }).kind,
        `burstMax=${run.burstMax}`
      ).toBe('within-budget')
    }
    const oldRejected = RUNS.filter((run) => !oldStatisticPasses(run.baselineMax, run.burstMax))
    expect(oldRejected.map((run) => run.burstMax)).toEqual([2106])
    // Eight runs the old statistic accepted were slower than the one it rejected.
    expect(RUNS.filter((run) => run.burstMax > 2106).length).toBe(8)
  })
})
