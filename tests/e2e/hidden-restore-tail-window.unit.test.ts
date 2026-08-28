import { describe, expect, it } from 'vitest'
import {
  describeRestoreSample,
  hiddenRestoreWithinBudget,
  tailWindowStart
} from './hidden-restore-tail-window'

describe('tailWindowStart', () => {
  it('anchors on the cursor so a scrollback taller than the window still reads the newest rows', () => {
    // 8000 rows of restored scrollback, cursor on the last one, 200-row window.
    expect(tailWindowStart({ baseY: 7960, cursorY: 39, lineCount: 200 })).toBe(7800)
  })

  it('never reads above the start of the buffer', () => {
    expect(tailWindowStart({ baseY: 0, cursorY: 5, lineCount: 200 })).toBe(0)
  })

  it('follows the cursor rather than the bottom of the grid', () => {
    // Same buffer, cursor parked mid-grid: the window must move with it.
    expect(tailWindowStart({ baseY: 7960, cursorY: 10, lineCount: 200 })).toBe(7771)
    expect(tailWindowStart({ baseY: 7960, cursorY: 39, lineCount: 200 })).toBe(7800)
  })
})

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
