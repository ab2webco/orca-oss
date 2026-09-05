import { describe, expect, it } from 'vitest'
import { MOBILE_TASKS_PLANE_CAPABILITY } from '../tasks/plane-mobile-task-source'
import {
  isPlaneBoardWritableByHost,
  MOBILE_PLANE_BOARD_WRITES_CAPABILITY
} from './plane-board-writes-capability'

describe('plane board writes capability', () => {
  it('mirrors the host constant byte for byte', () => {
    expect(MOBILE_PLANE_BOARD_WRITES_CAPABILITY).toBe('mobile.plane-board.writes.v1')
  })

  it('is off until the host advertises the write capability', () => {
    expect(isPlaneBoardWritableByHost(undefined)).toBe(false)
    expect(isPlaneBoardWritableByHost([])).toBe(false)
    // A phase-1 host: reads and the move work, create is refused at dispatch.
    expect(isPlaneBoardWritableByHost(['mobile.tasks.v1', MOBILE_TASKS_PLANE_CAPABILITY])).toBe(
      false
    )
  })

  it('is on when the host advertises the write capability', () => {
    expect(
      isPlaneBoardWritableByHost([
        'mobile.tasks.v1',
        MOBILE_TASKS_PLANE_CAPABILITY,
        MOBILE_PLANE_BOARD_WRITES_CAPABILITY
      ])
    ).toBe(true)
  })
})
