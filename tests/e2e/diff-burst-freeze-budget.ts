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
  readonly p95AllowanceMs: number
  readonly freezeCeilingMs: number
}

export type DiffBurstBudgetVerdict =
  | { readonly kind: 'within-budget' }
  | { readonly kind: 'sustained-blocking'; readonly reason: string }
  | { readonly kind: 'freeze'; readonly reason: string }

export function evaluateDiffBurstBudget(input: DiffBurstBudgetInput): DiffBurstBudgetVerdict {
  const { baselineP95Ms, burstP95Ms, burstMaxLagMs, p95AllowanceMs, freezeCeilingMs } = input
  const p95Ceiling = baselineP95Ms + p95AllowanceMs
  if (burstP95Ms > p95Ceiling) {
    return {
      kind: 'sustained-blocking',
      reason:
        `burst p95 ${burstP95Ms.toFixed(1)}ms over ${p95Ceiling.toFixed(1)}ms ` +
        `(idle p95 ${baselineP95Ms.toFixed(1)}ms + ${p95AllowanceMs}ms) — the window is blocking, not just spiking`
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
