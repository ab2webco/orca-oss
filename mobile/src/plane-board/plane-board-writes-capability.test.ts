import { describe, expect, it } from 'vitest'
import { MOBILE_TASKS_PLANE_CAPABILITY } from '../tasks/plane-mobile-task-source'
import {
  arePlaneMembersListableByHost,
  isPlaneBoardWritableByHost,
  MOBILE_PLANE_BOARD_MEMBERS_CAPABILITY,
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

  it('mirrors the host members constant byte for byte', () => {
    expect(MOBILE_PLANE_BOARD_MEMBERS_CAPABILITY).toBe('mobile.plane-board.members.v1')
  })

  it('keeps the assignee picker off a host that only advertises writes', () => {
    // Why: lab.52-54 announce writes.v1 and still refuse plane.listMembers at dispatch.
    expect(arePlaneMembersListableByHost(undefined)).toBe(false)
    expect(
      arePlaneMembersListableByHost([
        'mobile.tasks.v1',
        MOBILE_TASKS_PLANE_CAPABILITY,
        MOBILE_PLANE_BOARD_WRITES_CAPABILITY
      ])
    ).toBe(false)
  })

  it('turns the assignee picker on when the host advertises the member list', () => {
    expect(
      arePlaneMembersListableByHost([
        MOBILE_PLANE_BOARD_WRITES_CAPABILITY,
        MOBILE_PLANE_BOARD_MEMBERS_CAPABILITY
      ])
    ).toBe(true)
  })
})
