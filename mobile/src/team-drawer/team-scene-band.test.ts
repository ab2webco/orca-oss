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

const sceneOf = (over: Record<string, unknown> = {}, sceneArt = false) =>
  teamLeadViewOf(
    {
      role: 'lead',
      lead: { autostart: false, cap: 4, agent: 'claude' },
      leadName: 'Castillo',
      agents: [leader, member('tab-1:leaf'), member('tab-2:leaf', 'waiting')],
      panel: panel('game', 'figures'),
      ...over
    },
    new Set(),
    null,
    0,
    { sceneArt }
  )?.scene

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

  it('gives a member the seed its persistent character wears on the desktop', () => {
    const seeds = sceneOf()?.actors.map((one) => one.seed)
    expect(seeds).toEqual(sceneOf()?.actors.map((one) => one.seed))
    expect(new Set(seeds).size).toBe(3)
    expect(sceneOf()?.actors[0]?.seed).toBe(0)
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

const role = (sheets: string[]) => ({
  sheets,
  frame: { width: 64, height: 64 },
  size: 50,
  animations: { idle: { row: 1, frames: 2 } }
})
const mario = {
  config: { scene: 'mario' },
  extensions: {
    scenes: [
      {
        id: 'mario',
        pluginId: 'project',
        definition: {
          native: {
            figures: {
              layers: [{ src: 'sky.png' }, { src: 'bush.png', front: true }],
              roles: { lead: role(['mario.png']), member: role(['toad.png', 'luigi.png']) }
            }
          }
        }
      }
    ]
  }
}

describe("the scene band with a scene's own art", () => {
  it('offers the scene file art on a host that serves it, with the band it falls back to', () => {
    const band = sceneOf(mario, true)
    expect(band).toMatchObject({ kind: 'scene', style: 'figures', sceneId: 'mario' })
    expect(band?.kind === 'scene' && band.native.roles.lead.sheets).toEqual(['mario.png'])
    expect(band?.kind === 'scene' && band.fallback.kind).toBe('readable')
  })

  it("falls back to Orca's office for the Office style, as the desktop does when that art fails", () => {
    const office = {
      ...mario,
      panel: panel('game', 'office'),
      extensions: {
        scenes: [
          {
            ...mario.extensions.scenes[0],
            definition: {
              native: { office: mario.extensions.scenes[0]!.definition.native.figures }
            }
          }
        ]
      }
    }
    const band = sceneOf(office, true)
    expect(band?.kind === 'scene' && band.fallback).toMatchObject({ kind: 'art', style: 'office' })
    expect(sceneOf(office)).toMatchObject({ kind: 'art', style: 'office' })
  })

  it("never asks a host without mobile.team-scene.v1 for the scene's own art", () => {
    expect(sceneOf(mario)?.kind).toBe('readable')
  })
})
