import { describe, expect, it } from 'vitest'
import {
  REVEAL_HOLD_MAX_FRAMES,
  REVEAL_HOLD_MAX_MS,
  REVEAL_HOLD_QUIET_MS,
  startRevealHold,
  stepRevealHold,
  type RevealHold,
  type RevealHoldLayout,
  type RevealHoldSample,
  type RevealHoldStep
} from './reveal-hold'

const layout: RevealHoldLayout = { clientHeight: 585, scrollHeight: 1627, width: 470 }
const shrunk: RevealHoldLayout = { ...layout, clientHeight: 385 }
const FRAME_MS = 16
// A hidden window, like the headless E2E one on Linux, paints about once a second.
const HIDDEN_WINDOW_FRAME_MS = 1000

type Frame = Partial<Omit<RevealHoldSample, 'now'>>

/** Feeds one sample per frame, `gapMs` apart, and returns every step. */
function play(hold: RevealHold, frames: Frame[], gapMs: number, from = 0): RevealHoldStep[] {
  let current = hold
  return frames.map((frame, index) => {
    const result = stepRevealHold(current, {
      now: from + (index + 1) * gapMs,
      inView: true,
      layout,
      userScrolling: false,
      ...frame
    })
    current = result.hold
    return result.step
  })
}

const inView = (count: number): Frame[] => Array.from({ length: count }, () => ({}))

describe('stepRevealHold', () => {
  it('settles once the row has stayed in view for the quiet window', () => {
    const quietFrames = Math.ceil(REVEAL_HOLD_QUIET_MS / FRAME_MS)
    const steps = play(startRevealHold(0, layout), inView(quietFrames), FRAME_MS)

    expect(steps.slice(0, -1).every((step) => step === 'wait')).toBe(true)
    expect(steps.at(-1)).toBe('settled')
  })

  it('reasserts when a layout change moves the row out, and restarts the quiet window', () => {
    const steps = play(
      startRevealHold(0, layout),
      [...inView(20), { inView: false, layout: shrunk }, { layout: shrunk }],
      FRAME_MS
    )

    expect(steps.slice(-2)).toEqual(['reassert', 'wait'])
  })

  it('reasserts a row a restore moves out in the frame after the layout change', () => {
    const steps = play(
      startRevealHold(0, layout),
      [...inView(30), { layout: shrunk }, { inView: false, layout: shrunk }],
      FRAME_MS
    )

    expect(steps.slice(-2)).toEqual(['wait', 'reassert'])
  })

  it('lets go when the row leaves view with no layout change behind it', () => {
    const quietFrames = Math.ceil(REVEAL_HOLD_QUIET_MS / FRAME_MS)
    const steps = play(
      startRevealHold(0, layout),
      [...inView(quietFrames - 1), { inView: false }],
      FRAME_MS
    )

    expect(steps.at(-1)).toBe('released')
  })

  it('lets go as soon as the person scrolls', () => {
    const steps = play(
      startRevealHold(0, layout),
      [{ inView: false, layout: shrunk, userScrolling: true }],
      FRAME_MS
    )

    expect(steps).toEqual(['released'])
  })

  it('expires by time, however the layout keeps changing', () => {
    const frames = Math.ceil(REVEAL_HOLD_MAX_MS / FRAME_MS)
    const steps = play(
      startRevealHold(0, layout),
      Array.from({ length: frames }, (_, index) => ({
        inView: false,
        layout: index % 2 ? layout : shrunk
      })),
      FRAME_MS
    )

    expect(steps.at(-1)).toBe('expired')
    expect(steps.slice(0, -1)).not.toContain('expired')
  })

  it('does not settle on the first frame of a window that paints once a second', () => {
    const steps = play(startRevealHold(0, layout), inView(3), HIDDEN_WINDOW_FRAME_MS)

    expect(steps[0]).toBe('wait')
    expect(steps).toContain('settled')
  })

  it('reasserts a row pulled out between two frames of a window that paints once a second', () => {
    const steps = play(startRevealHold(0, layout), [{}, { inView: false }], HIDDEN_WINDOW_FRAME_MS)

    expect(steps).toEqual(['wait', 'reassert'])
  })

  it('gives a window that paints once a second as many frames as the old retry cap', () => {
    const steps = play(
      startRevealHold(0, layout),
      Array.from({ length: REVEAL_HOLD_MAX_FRAMES }, (_, index) => ({
        inView: false,
        layout: index % 2 ? layout : shrunk
      })),
      HIDDEN_WINDOW_FRAME_MS
    )

    expect(steps.slice(0, -1)).not.toContain('expired')
    expect(steps.at(-1)).toBe('expired')
  })
})
