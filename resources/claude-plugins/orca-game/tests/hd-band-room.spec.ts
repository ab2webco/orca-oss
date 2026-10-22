import { describe, expect, it } from 'vitest'

import { ADVISOR_PROP_WIDTH } from '../hooks/advisor-art'
import { hdBandRoomOf, hdHeroRoomOf, hdRestColumnOf } from '../hooks/hd-band-room'
import { hdTrailOf } from '../hooks/hd-party'

const HERO = 12
const PET = 11
const ADVISOR = 10
const WIDTHS = Array.from({ length: 200 }, (_, i) => 200 - i)

const roomAt = (columns: number) =>
  hdBandRoomOf({
    columns,
    heroWidth: HERO,
    petWidth: PET,
    advisorWidth: ADVISOR,
    hasGesture: true
  })

describe('what the hd band keeps as the pane narrows', () => {
  it('keeps the pet, the advisor and its gesture on a wide band', () => {
    expect(roomAt(160)).toMatchObject({
      isPetShown: true,
      isGestureShown: true,
      isAdvisorShown: true
    })
  })

  it('drops the pet, then the advisor’s gesture, then the advisor, and never brings one back', () => {
    const dropped = (pick: (room: ReturnType<typeof roomAt>) => boolean): number =>
      WIDTHS.find((columns) => !pick(roomAt(columns))) ?? 0
    const pet = dropped((room) => room.isPetShown)
    const gesture = dropped((room) => room.isGestureShown)
    const advisor = dropped((room) => room.isAdvisorShown)
    expect(pet).toBeGreaterThan(gesture)
    expect(gesture).toBeGreaterThan(advisor)
    expect(advisor).toBeGreaterThan(0)
    for (const columns of WIDTHS.filter((one) => one < pet)) {
      expect(roomAt(columns).isPetShown, `${columns}`).toBe(false)
    }
    for (const columns of WIDTHS.filter((one) => one < advisor)) {
      expect(roomAt(columns).isAdvisorShown, `${columns}`).toBe(false)
    }
  })

  it('leaves the hero, its fire and its pet a stage clear of the advisor and its gesture', () => {
    for (const columns of WIDTHS.filter((one) => one >= hdHeroRoomOf(HERO))) {
      const room = roomAt(columns)
      const advisorLeft = room.isAdvisorShown ? columns - ADVISOR : columns
      const gestureLeft = room.isGestureShown ? advisorLeft - ADVISOR_PROP_WIDTH : advisorLeft
      expect(room.stage, `${columns}`).toBeLessThanOrEqual(
        room.isAdvisorShown ? gestureLeft - 1 : columns
      )
      expect(room.stage, `${columns}`).toBeGreaterThanOrEqual(
        hdHeroRoomOf(HERO) + (room.isPetShown ? PET + 1 : 0)
      )
    }
  })

  it('drops a teammate rather than stand one over another', () => {
    for (let stage = 20; stage <= 200; stage += 1) {
      for (let count = 1; count <= 4; count += 1) {
        for (const petWidth of [0, PET]) {
          const trail = hdTrailOf({ stage, count, petWidth, spriteWidth: HERO, slack: 8 })
          if (trail.shown > 0) {
            expect(trail.pitch, `${stage} ${count} ${petWidth}`).toBe(HERO - 1)
          }
        }
      }
    }
    expect(
      hdTrailOf({ stage: 200, count: 4, petWidth: PET, spriteWidth: HERO, slack: 8 }).shown
    ).toBe(4)
  })

  it('without an advisor or a pet, gives the hero every column', () => {
    expect(
      hdBandRoomOf({
        columns: 30,
        heroWidth: HERO,
        petWidth: 0,
        advisorWidth: undefined,
        hasGesture: false
      })
    ).toEqual({ stage: 30, isPetShown: false, isGestureShown: false, isAdvisorShown: false })
  })

  it('seats the resting hero with its pet on the left and its fire inside the stage', () => {
    for (const columns of WIDTHS.filter((one) => one >= hdHeroRoomOf(HERO))) {
      const room = roomAt(columns)
      const pet = room.isPetShown ? PET + 1 : 0
      const left = hdRestColumnOf(room.stage, HERO, pet)
      expect(left, `${columns}`).toBeGreaterThanOrEqual(pet)
      expect(left + hdHeroRoomOf(HERO), `${columns}`).toBeLessThanOrEqual(room.stage)
    }
  })
})
