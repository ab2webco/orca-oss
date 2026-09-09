import { describe, expect, it } from 'vitest'
import { MOBILE_TASKS_PLANE_CAPABILITY } from '../tasks/plane-mobile-task-source'
import {
  arePlaneColumnsEditableByHost,
  arePlaneDateClearsSupportedByHost,
  arePlaneMembersListableByHost,
  isPlaneBoardWritableByHost,
  MOBILE_PLANE_BOARD_COLUMNS_CAPABILITY,
  MOBILE_PLANE_BOARD_DATE_CLEARS_CAPABILITY,
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

  it('keeps date clears off a host that only advertises writes', () => {
    expect(MOBILE_PLANE_BOARD_DATE_CLEARS_CAPABILITY).toBe('mobile.plane-board.date-clears.v1')
    expect(arePlaneDateClearsSupportedByHost(undefined)).toBe(false)
    expect(arePlaneDateClearsSupportedByHost([MOBILE_PLANE_BOARD_WRITES_CAPABILITY])).toBe(false)
    expect(arePlaneDateClearsSupportedByHost([MOBILE_PLANE_BOARD_DATE_CLEARS_CAPABILITY])).toBe(
      true
    )
  })

  it('mirrors the host columns constant byte for byte', () => {
    expect(MOBILE_PLANE_BOARD_COLUMNS_CAPABILITY).toBe('mobile.plane-board.columns.v1')
  })

  it('keeps column edits off a host that only advertises writes', () => {
    // Why: writes.v1 hosts refuse plane.updateState/deleteState at dispatch.
    expect(arePlaneColumnsEditableByHost(undefined)).toBe(false)
    expect(arePlaneColumnsEditableByHost([])).toBe(false)
    expect(
      arePlaneColumnsEditableByHost([
        'mobile.tasks.v1',
        MOBILE_TASKS_PLANE_CAPABILITY,
        MOBILE_PLANE_BOARD_WRITES_CAPABILITY,
        MOBILE_PLANE_BOARD_MEMBERS_CAPABILITY,
        MOBILE_PLANE_BOARD_DATE_CLEARS_CAPABILITY
      ])
    ).toBe(false)
  })

  it('turns column edits on when the host advertises them', () => {
    expect(
      arePlaneColumnsEditableByHost([
        MOBILE_PLANE_BOARD_WRITES_CAPABILITY,
        MOBILE_PLANE_BOARD_COLUMNS_CAPABILITY
      ])
    ).toBe(true)
  })
})
