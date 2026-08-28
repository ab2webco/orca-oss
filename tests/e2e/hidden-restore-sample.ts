export type RestoreLatencySample = {
  readonly elapsedMs: number
  readonly observerMs: number
  readonly polls: number
}

// Why the observer cost is carried and never subtracted: an observation that
// pays for itself inflates the very number under assertion, so the honest move
// is to make it cheap and report what it still costs — not to discount it.
export function describeRestoreSample(sample: RestoreLatencySample): string {
  const share = sample.elapsedMs > 0 ? (sample.observerMs / sample.elapsedMs) * 100 : 0
  return (
    `restore=${sample.elapsedMs.toFixed(1)}ms observer=${sample.observerMs.toFixed(1)}ms ` +
    `(${share.toFixed(0)}% of the measurement) polls=${sample.polls}`
  )
}

// Why the whole elapsed clock and not elapsed-minus-observer: discounting the
// instrument is how a ceiling gets retired while looking stricter. The observer
// cost is reported so it can be seen shrinking, never subtracted from the
// number under assertion.
export function hiddenRestoreWithinBudget(sample: RestoreLatencySample, budgetMs: number): boolean {
  return sample.elapsedMs < budgetMs
}
