/**
 * Holds a landed sidebar reveal until its row has stayed in view while the layout is quiet.
 *
 * A reveal lands in one frame, but a resize, a theme change, a late card or the scroll
 * anchor restoring an older position can move the row out a few frames later. Inside the
 * hold, a row moved out by a layout change is revealed again; the hold ends by time.
 */
export const REVEAL_HOLD_QUIET_MS = 400
export const REVEAL_HOLD_MAX_MS = 3000

export type RevealHoldLayout = { clientHeight: number; scrollHeight: number; width: number }

export type RevealHold = { startedAt: number; quietSince: number; layout: RevealHoldLayout }

export type RevealHoldSample = {
  now: number
  inView: boolean
  layout: RevealHoldLayout
  userScrolling: boolean
}

export type RevealHoldStep = 'wait' | 'reassert' | 'settled' | 'released' | 'expired'

export function startRevealHold(now: number, layout: RevealHoldLayout): RevealHold {
  return { startedAt: now, quietSince: now, layout }
}

function sameLayout(left: RevealHoldLayout, right: RevealHoldLayout): boolean {
  return (
    Math.abs(left.clientHeight - right.clientHeight) < 1 &&
    Math.abs(left.scrollHeight - right.scrollHeight) < 1 &&
    Math.abs(left.width - right.width) < 1
  )
}

export function stepRevealHold(
  hold: RevealHold,
  sample: RevealHoldSample
): { hold: RevealHold; step: RevealHoldStep } {
  if (sample.now - hold.startedAt >= REVEAL_HOLD_MAX_MS) {
    return { hold, step: 'expired' }
  }
  // Why: the person's scroll always wins over a reveal they did not just ask to keep.
  if (sample.userScrolling) {
    return { hold, step: 'released' }
  }
  const next = sameLayout(hold.layout, sample.layout)
    ? hold
    : { ...hold, quietSince: sample.now, layout: sample.layout }
  const quietFor = sample.now - next.quietSince
  if (!sample.inView) {
    // Why: out of view right after a layout change is that change's doing; out of view with
    // nothing moving is someone scrolling, which the hold must not undo.
    return { hold: next, step: quietFor < REVEAL_HOLD_QUIET_MS ? 'reassert' : 'released' }
  }
  return { hold: next, step: quietFor >= REVEAL_HOLD_QUIET_MS ? 'settled' : 'wait' }
}
