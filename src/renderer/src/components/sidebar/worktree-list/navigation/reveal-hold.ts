/**
 * Holds a landed sidebar reveal until its row has stayed in view while the layout is quiet.
 *
 * A reveal lands in one frame, but a resize, a theme change, a late card or the scroll
 * anchor restoring an older position can move the row out a few frames later. Inside the
 * hold, a row moved out by a layout change is revealed again; the hold ends by time.
 *
 * Windows and frames both count: a hidden window paints about once a second, so a quiet
 * window or a time cap met in a single frame would decide on what one frame saw.
 */
export const REVEAL_HOLD_QUIET_MS = 400
export const REVEAL_HOLD_QUIET_FRAMES = 3
export const REVEAL_HOLD_MAX_MS = 3000
export const REVEAL_HOLD_MAX_FRAMES = 8

export type RevealHoldLayout = { clientHeight: number; scrollHeight: number; width: number }

export type RevealHold = {
  startedAt: number
  frames: number
  quietSince: number
  quietFrames: number
  layout: RevealHoldLayout
}

export type RevealHoldSample = {
  now: number
  inView: boolean
  layout: RevealHoldLayout
  userScrolling: boolean
}

export type RevealHoldStep = 'wait' | 'reassert' | 'settled' | 'released' | 'expired'

export function startRevealHold(now: number, layout: RevealHoldLayout): RevealHold {
  return { startedAt: now, frames: 0, quietSince: now, quietFrames: 0, layout }
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
  const frames = hold.frames + 1
  if (sample.now - hold.startedAt >= REVEAL_HOLD_MAX_MS && frames >= REVEAL_HOLD_MAX_FRAMES) {
    return { hold: { ...hold, frames }, step: 'expired' }
  }
  // Why: the person's scroll always wins over a reveal they did not just ask to keep.
  if (sample.userScrolling) {
    return { hold: { ...hold, frames }, step: 'released' }
  }
  const next = sameLayout(hold.layout, sample.layout)
    ? { ...hold, frames, quietFrames: hold.quietFrames + 1 }
    : { ...hold, frames, quietSince: sample.now, quietFrames: 0, layout: sample.layout }
  const quiet =
    sample.now - next.quietSince >= REVEAL_HOLD_QUIET_MS &&
    next.quietFrames >= REVEAL_HOLD_QUIET_FRAMES
  if (!sample.inView) {
    // Why: out of view right after a layout change is that change's doing; out of view with
    // nothing moving is someone scrolling, which the hold must not undo.
    return quiet
      ? { hold: next, step: 'released' }
      : // Why: the reveal is about to put the row back; quiet is counted from there.
        { hold: { ...next, quietSince: sample.now, quietFrames: 0 }, step: 'reassert' }
  }
  return { hold: next, step: quiet ? 'settled' : 'wait' }
}
