// What detects the STA-3420 regression, and what does not.
//
// The commit that fixed it measured the answer already: "the burst window's peak
// lag is dominated by a one-off stall from opening 8x15k-line Monaco editors,
// which reproduces identically with invalidation disabled" (034fa50970). The peak
// never discriminated. The regression's own signature was p95 3963ms and 16
// samples in 23s against 360 expected — sustained blocking that starves the
// sampler, which p95 and sample coverage both catch and a peak does not.
//
// So: p95 and coverage are the regression detectors. The peak clause is a
// catastrophic-freeze detector and nothing more — deliberately loose, fixed, and
// not asked to carry sensitivity it has never had.
//
// It is fixed rather than baseline-relative because deriving it from the idle
// window's own peak made it a coin: baseline.maxLagMs is bimodal on CI (~250-730ms
// clean, ~8500-12100ms when an unrelated stall lands in it), so the ceiling was
// most permissive exactly when the machine was worst. Across sixteen runs the one
// red had the LOWEST burst peak of all of them while eight slower runs passed,
// one at 5074ms (ORCA-320).

// Why the peak is judged against a fixed ceiling and not the idle window's own
// peak: baseline.maxLagMs is bimodal on CI — ~250-730ms when the idle window is
// clean, ~8500-12100ms when an unrelated stall lands in it. Deriving the
// allowance from it made the pass rate P(a stall landed), so the run with the
// LOWEST burst peak of sixteen was the one that failed, while eight slower runs
// passed — one of them 2.4x slower. The p95 clause below is the sensitive one; this is a freeze detector.

// Why 100ms on the idle p95: this is the clause that caught the original bug,
// whose burst p95 was 3963ms against an idle floor near zero.
export const BURST_P95_ALLOWANCE_MS = 100
// Derived from 16 CI runs of this spec: healthy burst peaks span 5-5074ms. A
// freeze detector, deliberately loose; the p95 clause carries the sensitivity.
export const BURST_FREEZE_CEILING_MS = 8_000

export type DiffBurstBudgetInput = {
  readonly baselineP95Ms: number
  readonly burstP95Ms: number
  readonly burstMaxLagMs: number
  readonly burstSampleCount: number
  readonly expectedSampleCount: number
  readonly p95AllowanceMs: number
  readonly freezeCeilingMs: number
}

export type DiffBurstBudgetVerdict =
  | { readonly kind: 'within-budget' }
  | { readonly kind: 'sustained-blocking'; readonly reason: string }
  | { readonly kind: 'starved-sampler'; readonly reason: string }
  | { readonly kind: 'freeze'; readonly reason: string }

export const BURST_SAMPLE_COVERAGE_FLOOR = 0.85

export function evaluateDiffBurstBudget(input: DiffBurstBudgetInput): DiffBurstBudgetVerdict {
  const {
    baselineP95Ms,
    burstP95Ms,
    burstMaxLagMs,
    burstSampleCount,
    expectedSampleCount,
    p95AllowanceMs,
    freezeCeilingMs
  } = input
  const p95Ceiling = baselineP95Ms + p95AllowanceMs
  if (burstP95Ms > p95Ceiling) {
    return {
      kind: 'sustained-blocking',
      reason:
        `burst p95 ${burstP95Ms.toFixed(1)}ms over ${p95Ceiling.toFixed(1)}ms ` +
        `(idle p95 ${baselineP95Ms.toFixed(1)}ms + ${p95AllowanceMs}ms) — the window is blocking, not just spiking`
    }
  }
  const sampleFloor = expectedSampleCount * BURST_SAMPLE_COVERAGE_FLOOR
  if (burstSampleCount < sampleFloor) {
    return {
      kind: 'starved-sampler',
      reason:
        `burst collected ${burstSampleCount} of ${expectedSampleCount} expected samples ` +
        `(floor ${sampleFloor.toFixed(0)}) — the loop could not run, which is what a block looks like from inside`
    }
  }
  if (burstMaxLagMs > freezeCeilingMs) {
    return {
      kind: 'freeze',
      reason: `burst peak ${burstMaxLagMs.toFixed(0)}ms over the ${freezeCeilingMs}ms freeze ceiling`
    }
  }
  return { kind: 'within-budget' }
}
