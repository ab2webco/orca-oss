import { describe, expect, it } from 'vitest'
import { teamLeadViewOf } from './team-drawer-model'

const leader = {
  paneKey: 'tab-0:leaf',
  displayName: 'Lead pane',
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: true,
  isMember: false
}
const member = (paneKey: string, state = 'working') => ({
  paneKey,
  displayName: paneKey,
  agentType: 'claude',
  state,
  toolName: null,
  isLeader: false,
  isMember: true
})

const panel = (look: string, style: string) => ({
  look,
  style,
  tabs: { prs: true, queue: true, machines: true },
  advisor: true,
  arcade: true
})

const sceneOf = (over: Record<string, unknown> = {}) =>
  teamLeadViewOf({
    role: 'lead',
    lead: { autostart: false, cap: 4, agent: 'claude' },
    leadName: 'Castillo',
    agents: [leader, member('tab-1:leaf'), member('tab-2:leaf', 'waiting')],
    panel: panel('game', 'figures'),
    ...over
  })?.scene

describe('the Team sheet scene band', () => {
  it("draws Quest's own art in the desktop's Figures or Office style, lead first", () => {
    const band = sceneOf()
    expect(band).toMatchObject({ kind: 'art', style: 'figures' })
    expect(band?.actors.map((one) => one.role)).toEqual(['lead', 'member', 'member'])
    expect(sceneOf({ panel: panel('game', 'office') })).toMatchObject({
      kind: 'art',
      style: 'office'
    })
  })

  it('gives a member the sheet its persistent character wears on the desktop', () => {
    const sheets = sceneOf()?.actors.map((one) => one.sheet)
    expect(sheets).toEqual(sceneOf()?.actors.map((one) => one.sheet))
    expect(sheets?.every((one) => one >= 0 && one < 8)).toBe(true)
    expect(sceneOf()?.actors[0]?.sheet).toBe(0)
  })

  it('adds the advisor at the end when the lead has Jev', () => {
    const band = sceneOf({
      agents: [
        {
          ...leader,
          advisor: { model: null, effort: null, pinned: { model: false, effort: false } }
        },
        member('tab-1:leaf')
      ]
    })
    expect(band?.actors.map((one) => one.role)).toEqual(['lead', 'member', 'advisor'])
  })

  it('reads the Pixel style, a themed scene in Figures, or an older host as the readable band', () => {
    expect(sceneOf({ panel: panel('game', 'pixel') })?.kind).toBe('readable')
    expect(sceneOf({ config: { scene: 'night-watch' } })?.kind).toBe('readable')
    expect(sceneOf({ panel: undefined })?.kind).toBe('readable')
  })

  it("keeps Orca's office in a themed scene, as the desktop does", () => {
    expect(
      sceneOf({ config: { scene: 'night-watch' }, panel: panel('game', 'office') })
    ).toMatchObject({ kind: 'art', style: 'office' })
  })

  it('draws no band when the desktop panel is not in the Game look', () => {
    expect(sceneOf({ panel: panel('plain', 'figures') })).toBeNull()
    expect(sceneOf({ panel: panel('display', 'figures') })).toBeNull()
  })
})
