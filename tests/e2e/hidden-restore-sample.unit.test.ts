import { describe, expect, it } from 'vitest'
import { describeRestoreSample, hiddenRestoreWithinBudget } from './hidden-restore-sample'

describe('describeRestoreSample', () => {
  it('states what share of the measurement the observer paid for', () => {
    expect(describeRestoreSample({ elapsedMs: 2000, observerMs: 1500, polls: 20 })).toBe(
      'restore=2000.0ms observer=1500.0ms (75% of the measurement) polls=20'
    )
  })

  it('survives a zero-length measurement without reporting NaN', () => {
    expect(describeRestoreSample({ elapsedMs: 0, observerMs: 0, polls: 0 })).toContain('(0% of')
  })
})

describe('hiddenRestoreWithinBudget', () => {
  const BUDGET_MS = 2_000

  it('holds just under the ceiling and fails just over it', () => {
    expect(
      hiddenRestoreWithinBudget({ elapsedMs: 1999, observerMs: 40, polls: 12 }, BUDGET_MS)
    ).toBe(true)
    expect(
      hiddenRestoreWithinBudget({ elapsedMs: 2000, observerMs: 40, polls: 12 }, BUDGET_MS)
    ).toBe(false)
    // The value that opened ORCA-316.
    expect(
      hiddenRestoreWithinBudget({ elapsedMs: 2168.77, observerMs: 40, polls: 12 }, BUDGET_MS)
    ).toBe(false)
  })

  // The control that matters: a cheaper observer must not rescue a slow restore.
  it('still fails a genuinely slow restore once the observer costs almost nothing', () => {
    expect(
      hiddenRestoreWithinBudget({ elapsedMs: 2100, observerMs: 5, polls: 21 }, BUDGET_MS)
    ).toBe(false)
    expect(
      hiddenRestoreWithinBudget({ elapsedMs: 2100, observerMs: 0, polls: 21 }, BUDGET_MS)
    ).toBe(false)
  })

  it('does not credit a fast restore for an expensive observer either', () => {
    expect(
      hiddenRestoreWithinBudget({ elapsedMs: 2400, observerMs: 1500, polls: 20 }, BUDGET_MS)
    ).toBe(false)
  })
})
