import { describe, expect, it } from 'vitest'
import { figureLookOf } from './team-scene-figure-looks'

const actor = (
  role: 'lead' | 'member' | 'advisor',
  key: string,
  characterKey: string | null = null
) => ({
  role,
  key,
  characterKey
})

describe('figureLookOf', () => {
  it('crowns only the lead', () => {
    expect(figureLookOf(actor('lead', 'lead')).hat).toBe('crown')
    const members = Array.from({ length: 40 }, (_, i) => figureLookOf(actor('member', `m${i}`)))
    expect(members.some((look) => look.hat === 'crown')).toBe(false)
  })

  it('gives a member the same look on every frame and every host', () => {
    expect(figureLookOf(actor('member', 'pane-1', 'arthur'))).toEqual(
      figureLookOf(actor('member', 'pane-2', 'arthur'))
    )
  })

  it('tells members apart', () => {
    const looks = ['arthur', 'merlin', 'gawain', 'percival', 'tristan'].map((k) =>
      JSON.stringify(figureLookOf(actor('member', k, k)))
    )
    expect(new Set(looks).size).toBeGreaterThan(3)
  })

  it('dresses the advisor as a wizard with a staff', () => {
    expect(figureLookOf(actor('advisor', 'advisor'))).toMatchObject({
      hat: 'wizard',
      tool: 'staff'
    })
  })
})
