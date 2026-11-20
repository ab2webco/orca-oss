import { describe, expect, it } from 'vitest'
import { dioramaActionOf, dioramaPlotViewOf } from './team-diorama-actions'
import type { TeamSceneMemberInput } from './team-scene-types'

const member = (over: Partial<TeamSceneMemberInput> = {}): TeamSceneMemberInput => ({
  key: 'm',
  name: 'Ada',
  characterKey: null,
  activity: 'working',
  reportId: null,
  mergedPr: null,
  site: { stage: 1, broken: false },
  ...over
})

describe('what a member does at its plot', () => {
  it.each([
    [{}, 'build'],
    [{ activity: 'needsYou' as const }, 'signal'],
    [{ ci: 'pending' as const, site: { stage: 2 as const, broken: false } }, 'inspect'],
    [{ ci: 'failure' as const, site: { stage: 2 as const, broken: true } }, 'repair'],
    [{ ci: 'success' as const, site: { stage: 3 as const, broken: false } }, 'wait'],
    [{ mergedPr: 12, site: { stage: 4 as const, broken: false } }, 'cheer'],
    [{ activity: 'resting' as const }, 'idle'],
    [{ activity: 'blocked' as const, hold: 'limited' as const }, 'rest'],
    [{ activity: 'blocked' as const, hold: 'unreachable' as const }, 'gone'],
    [{ activity: 'blocked' as const, hold: 'queued' as const }, 'start'],
    [{ away: true as const }, 'gone']
  ])('reads %o as %s', (over, action) => {
    expect(dioramaActionOf(member(over))).toBe(action)
  })

  it('puts needing the user before a red build, so the signal is never hidden by the fire', () => {
    expect(dioramaActionOf(member({ activity: 'needsYou', ci: 'failure' }))).toBe('signal')
  })

  it('draws each action with its own build, scaffold, fire and flag', () => {
    expect(dioramaPlotViewOf(member())).toMatchObject({
      stage: 2,
      scaffold: 'wood',
      fire: false,
      flag: null
    })
    expect(
      dioramaPlotViewOf(member({ ci: 'pending', site: { stage: 2, broken: false } }))
    ).toMatchObject({ stage: 3, scaffold: 'lit' })
    expect(
      dioramaPlotViewOf(member({ ci: 'failure', site: { stage: 2, broken: true } }))
    ).toMatchObject({ fire: true })
    expect(
      dioramaPlotViewOf(member({ mergedPr: 3, site: { stage: 4, broken: false } }))
    ).toMatchObject({ stage: 4, flag: 'merged' })
  })

  it('spreads free members over fishing, farming and chopping by their place', () => {
    const free = member({ activity: 'resting' })
    expect([0, 1, 2, 3].map((i) => dioramaPlotViewOf(free, i).play)).toEqual([
      'fish',
      'farm',
      'chop',
      'fish'
    ])
  })
})
