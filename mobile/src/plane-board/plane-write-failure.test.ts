import { describe, expect, it } from 'vitest'
import type { PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import {
  describePlaneWriteRejection,
  PLANE_WRITE_REQUEST_OPTIONS,
  PLANE_WRITE_UNANSWERED_MESSAGE,
  unansweredPlaneCreateLanded
} from './plane-write-failure'

describe('plane write failure', () => {
  it('turns a transport rejection into a failure the board can show', () => {
    expect(describePlaneWriteRejection(new Error('Connection interrupted'))).toEqual({
      ok: false,
      error: 'Connection interrupted'
    })
  })

  it('flags a timed-out write: the host may have applied it', () => {
    const rejection = describePlaneWriteRejection(
      markRpcDeliveryUnknown(new Error('Request timed out: plane.createWorkItem'))
    )
    expect(rejection).toEqual({
      ok: false,
      error: PLANE_WRITE_UNANSWERED_MESSAGE,
      deliveryUnknown: true
    })
  })

  it('falls back to a readable message for a rejection without one', () => {
    expect(describePlaneWriteRejection('boom')).toEqual({
      ok: false,
      error: 'The write did not reach the host'
    })
  })

  it('bounds the whole write, connect wait included', () => {
    expect(PLANE_WRITE_REQUEST_OPTIONS).toEqual({ timeoutMs: 15_000, budgetSpansConnect: true })
  })

  describe('unansweredPlaneCreateLanded', () => {
    const card = (id: string, stateId: string, title: string): PlaneMobileWorkItem =>
      ({ id, title, state: { id: stateId, name: '', group: '' } }) as PlaneMobileWorkItem
    const known = new Set(['wi-1'])

    it('sees the asked card once a re-read shows it as new in the asked column', () => {
      const items = [card('wi-1', 's1', 'Ship it'), card('wi-2', 's1', 'Ship it')]
      expect(unansweredPlaneCreateLanded(items, known, 's1', 'Ship it')).toBe(true)
    })

    it('does not mistake a card already there, in another column, or titled differently', () => {
      expect(
        unansweredPlaneCreateLanded([card('wi-1', 's1', 'Ship it')], known, 's1', 'Ship it')
      ).toBe(false)
      expect(
        unansweredPlaneCreateLanded([card('wi-2', 's2', 'Ship it')], known, 's1', 'Ship it')
      ).toBe(false)
      expect(
        unansweredPlaneCreateLanded([card('wi-2', 's1', 'Ship it!')], known, 's1', 'Ship it')
      ).toBe(false)
    })
  })
})
