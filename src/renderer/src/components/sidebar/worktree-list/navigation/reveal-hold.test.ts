import { describe, expect, it } from 'vitest'
import {
  REVEAL_HOLD_MAX_MS,
  REVEAL_HOLD_QUIET_MS,
  startRevealHold,
  stepRevealHold,
  type RevealHoldLayout
} from './reveal-hold'

const layout: RevealHoldLayout = { clientHeight: 585, scrollHeight: 1627, width: 470 }
const shrunk: RevealHoldLayout = { ...layout, clientHeight: 385 }

describe('stepRevealHold', () => {
  it('settles once the row has stayed in view for the quiet window', () => {
    const hold = startRevealHold(0, layout)
    expect(stepRevealHold(hold, { now: 16, inView: true, layout, userScrolling: false }).step).toBe(
      'wait'
    )
    expect(
      stepRevealHold(hold, {
        now: REVEAL_HOLD_QUIET_MS,
        inView: true,
        layout,
        userScrolling: false
      }).step
    ).toBe('settled')
  })

  it('reasserts when a layout change moves the row out, and restarts the quiet window', () => {
    const late = REVEAL_HOLD_QUIET_MS - 16
    const first = stepRevealHold(startRevealHold(0, layout), {
      now: late,
      inView: true,
      layout,
      userScrolling: false
    })
    const moved = stepRevealHold(first.hold, {
      now: late + 16,
      inView: false,
      layout: shrunk,
      userScrolling: false
    })
    expect(moved.step).toBe('reassert')
    const back = stepRevealHold(moved.hold, {
      now: late + REVEAL_HOLD_QUIET_MS,
      inView: true,
      layout: shrunk,
      userScrolling: false
    })
    expect(back.step).toBe('wait')
  })

  it('reasserts a row a restore moves out in the frame after the layout change', () => {
    const changed = stepRevealHold(startRevealHold(0, layout), {
      now: 500,
      inView: true,
      layout: shrunk,
      userScrolling: false
    })
    expect(changed.step).toBe('wait')
    expect(
      stepRevealHold(changed.hold, {
        now: 516,
        inView: false,
        layout: shrunk,
        userScrolling: false
      }).step
    ).toBe('reassert')
  })

  it('lets go when the row leaves view with no layout change behind it', () => {
    expect(
      stepRevealHold(startRevealHold(0, layout), {
        now: REVEAL_HOLD_QUIET_MS + 16,
        inView: false,
        layout,
        userScrolling: false
      }).step
    ).toBe('released')
  })

  it('lets go as soon as the person scrolls', () => {
    expect(
      stepRevealHold(startRevealHold(0, layout), {
        now: 16,
        inView: false,
        layout: shrunk,
        userScrolling: true
      }).step
    ).toBe('released')
  })

  it('expires by time, however the layout keeps changing', () => {
    expect(
      stepRevealHold(startRevealHold(0, layout), {
        now: REVEAL_HOLD_MAX_MS,
        inView: false,
        layout: shrunk,
        userScrolling: false
      }).step
    ).toBe('expired')
  })
})
