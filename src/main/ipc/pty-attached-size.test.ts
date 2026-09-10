// A hidden pane reports xterm's unmeasured 80x24. Before this, main recorded
// that as the live session's size on every reattach, so a 176-column agent
// running on a server became 80 wide in main's own bookkeeping.
import { describe, expect, it } from 'vitest'
import { resolveCommittedPtySize } from './pty-attached-size'

const REQUESTED = { cols: 80, rows: 24 }

describe('resolveCommittedPtySize', () => {
  it('takes the request for a fresh spawn, where it is the truth', () => {
    expect(
      resolveCommittedPtySize({
        result: { snapshotCols: 176, snapshotRows: 59 },
        requested: REQUESTED,
        cachedBeforeAttach: { cols: 120, rows: 40 }
      })
    ).toEqual(REQUESTED)
  })

  it('prefers the grid the snapshot was captured at on a reattach', () => {
    expect(
      resolveCommittedPtySize({
        result: { isReattach: true, snapshotCols: 176, snapshotRows: 59 },
        requested: REQUESTED,
        cachedBeforeAttach: { cols: 120, rows: 40 }
      })
    ).toEqual({ cols: 176, rows: 59 })
  })

  it('falls back to the size main already held when the snapshot has none', () => {
    expect(
      resolveCommittedPtySize({
        result: { isReattach: true },
        requested: REQUESTED,
        cachedBeforeAttach: { cols: 120, rows: 40 }
      })
    ).toEqual({ cols: 120, rows: 40 })
  })

  it('takes the request only when nothing better is known', () => {
    expect(
      resolveCommittedPtySize({
        result: { isReattach: true },
        requested: REQUESTED,
        cachedBeforeAttach: undefined
      })
    ).toEqual(REQUESTED)
  })

  // Why: a zero or fractional grid is not "smaller", it is unusable — xterm
  // throws on a zero dimension, so a bad value must fall through, not win.
  it('rejects a non-positive or fractional grid instead of committing it', () => {
    expect(
      resolveCommittedPtySize({
        result: { isReattach: true, snapshotCols: 0, snapshotRows: 59 },
        requested: REQUESTED,
        cachedBeforeAttach: { cols: 120.5, rows: 40 }
      })
    ).toEqual(REQUESTED)
  })
})
