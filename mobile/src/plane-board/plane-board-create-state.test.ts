import { describe, expect, it } from 'vitest'
import {
  beginPlaneBoardCreate,
  canSubmitPlaneBoardCreate,
  IDLE_PLANE_BOARD_CREATE,
  resolvePlaneBoardCreateTitle,
  settlePlaneBoardCreate
} from './plane-board-create-state'

describe('plane board create state', () => {
  it('starts pending with the previous error cleared', () => {
    expect(beginPlaneBoardCreate()).toEqual({ pending: true, error: null })
  })

  it('returns to idle after a successful create', () => {
    expect(settlePlaneBoardCreate({ ok: true, id: 'wi-1', identifier: 'ORCA-1' })).toEqual(
      IDLE_PLANE_BOARD_CREATE
    )
  })

  it('keeps the host message after a refused create', () => {
    expect(settlePlaneBoardCreate({ ok: false, error: 'Title is required' })).toEqual({
      pending: false,
      error: 'Title is required'
    })
  })

  it('trims the title and rejects a blank one', () => {
    expect(resolvePlaneBoardCreateTitle('  Ship it  ')).toBe('Ship it')
    expect(resolvePlaneBoardCreateTitle('   ')).toBeNull()
    expect(resolvePlaneBoardCreateTitle('')).toBeNull()
  })

  it('only submits an idle state with a real title', () => {
    expect(canSubmitPlaneBoardCreate(IDLE_PLANE_BOARD_CREATE, 'Ship it')).toBe(true)
    expect(canSubmitPlaneBoardCreate(IDLE_PLANE_BOARD_CREATE, '  ')).toBe(false)
    expect(canSubmitPlaneBoardCreate(beginPlaneBoardCreate(), 'Ship it')).toBe(false)
    // An error does not block a retry; only an in-flight create does.
    expect(canSubmitPlaneBoardCreate({ pending: false, error: 'refused' }, 'Ship it')).toBe(true)
  })
})
