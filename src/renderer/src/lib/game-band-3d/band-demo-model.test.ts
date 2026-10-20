import { describe, expect, it } from 'vitest'
import { DEMO_FRAMES } from '../../../../../resources/claude-plugins/orca-game/hooks/demo'
import { LIVES_START } from './lives-rules'
import { bandModelAt, DEMO_STEP_MS, lifeEventsOfStep } from './band-demo-model'

const stepAt = (step: number): number => step * DEMO_STEP_MS + 1

describe('lifeEventsOfStep', () => {
  it('turns the demo review into red, green, merged and reverted events for working seats', () => {
    const kinds = new Set(
      Array.from({ length: DEMO_FRAMES }, (_, step) => lifeEventsOfStep(0, step))
        .flat()
        .map((event) => event.kind)
    )
    expect(kinds).toEqual(new Set(['ci-red', 'ci-green', 'merged', 'reverted']))
  })

  it('gives each event an id unique to its cycle, step and member', () => {
    const ids = [0, 1]
      .flatMap((cycle) =>
        Array.from({ length: DEMO_FRAMES }, (_, step) => lifeEventsOfStep(cycle, step))
      )
      .flat()
      .map((event) => event.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('bandModelAt', () => {
  it('seats the lead and five members', () => {
    const model = bandModelAt(0)
    expect(model.members.filter((member) => member.isLead)).toHaveLength(1)
    expect(model.members.filter((member) => !member.isLead)).toHaveLength(5)
  })

  it('changes lives as the script plays and starts each cycle fresh', () => {
    const start = bandModelAt(1)
    expect(start.members.every((member) => member.lives === LIVES_START)).toBe(true)
    const seen = new Set<number>()
    for (let step = 0; step < DEMO_FRAMES; step += 1) {
      for (const member of bandModelAt(stepAt(step)).members) {
        seen.add(member.lives)
      }
    }
    expect([...seen].some((lives) => lives < LIVES_START)).toBe(true)
    expect([...seen].some((lives) => lives > LIVES_START - 1)).toBe(true)
    expect(bandModelAt(stepAt(DEMO_FRAMES)).members.every((m) => m.lives === LIVES_START)).toBe(
      true
    )
  })

  it('marks a fresh life change so the band can animate it', () => {
    const changes = Array.from({ length: DEMO_FRAMES }, (_, step) => bandModelAt(stepAt(step)))
      .flatMap((model) => model.members)
      .flatMap((member) => (member.lifeChange === null ? [] : [member.lifeChange.delta]))
    expect(changes).toContain(-1)
    expect(changes).toContain(1)
  })

  it('gives every member a ticket, a review and the CI for the card', () => {
    for (const member of bandModelAt(stepAt(2)).members) {
      expect(member.ticket).not.toBe('')
      expect(member.review).toMatch(/^#\d+$/)
    }
    expect(bandModelAt(stepAt(2)).ci).toBe('failure')
  })
})
