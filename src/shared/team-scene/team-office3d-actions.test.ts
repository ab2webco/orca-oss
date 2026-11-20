import { describe, expect, it } from 'vitest'
import { office3dPlayOf, office3dSeatViewOf } from './team-office3d-actions'
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

describe('a desk in the 3D Office', () => {
  it.each([
    [{}, 'type', null],
    [{ activity: 'needsYou' as const }, 'raise', 'alert'],
    [{ activity: 'needsYou' as const, paneAsk: true as const }, 'raise', 'prompt'],
    [{ activity: 'done' as const }, 'done', 'check'],
    [{ activity: 'done' as const, mergedPr: 7 }, 'done', 'check'],
    [{ activity: 'resting' as const }, 'rest', null],
    [{ activity: 'blocked' as const, hold: 'limited' as const }, 'slump', 'blocked'],
    [{ activity: 'blocked' as const, hold: 'asleep' as const }, 'slump', 'blocked'],
    [{ activity: 'blocked' as const, hold: 'loggedOut' as const }, 'idle', 'blocked'],
    [{ activity: 'blocked' as const, hold: 'starting' as const }, 'idle', 'blocked']
  ])('reads %o as pose %s, mark %s', (over, pose, mark) => {
    const view = office3dSeatViewOf(member(over))
    expect(view.pose).toBe(pose)
    expect(view.mark).toBe(mark)
  })

  it("shows the card's desk on the monitor, a hold's own screen, idle when resting, code otherwise", () => {
    expect(office3dSeatViewOf(member({ desk: { kind: 'tests' } })).screen).toEqual({
      kind: 'desk',
      desk: { kind: 'tests' }
    })
    expect(office3dSeatViewOf(member({ activity: 'blocked', hold: 'limited' })).screen).toEqual({
      kind: 'hold',
      hold: 'limited'
    })
    expect(office3dSeatViewOf(member({ activity: 'resting' })).screen).toEqual({ kind: 'idle' })
    expect(office3dSeatViewOf(member()).screen).toEqual({ kind: 'code' })
  })

  it('draws the red-CI bug until CI is green, never on an empty or unreachable desk', () => {
    expect(office3dSeatViewOf(member({ ci: 'failure' })).virus).toBe(true)
    expect(office3dSeatViewOf(member({ site: { stage: 2, broken: true } })).virus).toBe(true)
    expect(office3dSeatViewOf(member({ ci: 'failure' }), false).virus).toBe(false)
    expect(office3dSeatViewOf(member({ ci: 'failure', away: true })).virus).toBe(false)
  })

  it('empties the chair of a gone session and a queued launch; the queued one shows its clock', () => {
    const gone = office3dSeatViewOf(member({ away: true }))
    expect([gone.empty, gone.screen, gone.mark]).toEqual([true, { kind: 'off' }, null])
    const queued = office3dSeatViewOf(member({ activity: 'blocked', hold: 'queued' }))
    expect([queued.empty, queued.screen]).toEqual([true, { kind: 'hold', hold: 'queued' }])
  })

  it('fades every member of an unreachable machine, with static on its screen and no mark', () => {
    const view = office3dSeatViewOf(member({ activity: 'needsYou' }), false)
    expect([view.faded, view.screen, view.mark]).toEqual([
      true,
      { kind: 'hold', hold: 'unreachable' },
      null
    ])
  })

  it('keeps the task board as the site says, broken card and all', () => {
    expect(office3dSeatViewOf(member({ site: { stage: 3, broken: true } })).board).toEqual({
      stage: 3,
      broken: true
    })
  })

  it('gives only a resting, seated, reachable member a play, rotated like the 2D row', () => {
    const resting = office3dSeatViewOf(member({ activity: 'resting' }))
    expect(office3dPlayOf(resting, 0, 0)).toBe('music')
    expect(office3dPlayOf(resting, 1, 0)).toBe('sketch')
    expect(office3dPlayOf(office3dSeatViewOf(member()), 0, 0)).toBeNull()
    expect(
      office3dPlayOf(office3dSeatViewOf(member({ activity: 'resting' }), false), 0, 0)
    ).toBeNull()
  })
})
