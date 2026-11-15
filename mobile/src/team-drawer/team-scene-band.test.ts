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
const member = (paneKey: string, state = 'working', over: Record<string, unknown> = {}) => ({
  paneKey,
  displayName: paneKey,
  agentType: 'claude',
  state,
  toolName: null,
  isLeader: false,
  isMember: true,
  ...over
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

const stageOf = (over: Record<string, unknown> = {}, sceneArt = false) => {
  const band = sceneOf(over, sceneArt)
  if (band?.kind !== 'stage') {
    throw new Error(`expected a stage, got ${band?.kind}`)
  }
  return band
}

describe('the Team sheet scene band', () => {
  it("draws the desktop's own stage in its Figures, Office and Pixel styles", () => {
    expect(stageOf().art).toEqual({ kind: 'bundled', style: 'figures' })
    expect(stageOf({ panel: panel('game', 'office') }).art).toEqual({
      kind: 'bundled',
      style: 'office'
    })
    // Why: Pixel was a names-only strip; the desktop draws it as a live stage.
    expect(stageOf({ panel: panel('game', 'pixel') }).art).toEqual({
      kind: 'pixel',
      sceneId: 'quest'
    })
  })

  it("feeds the desktop's scene director each member's real state, so it walks, sits and waits", () => {
    const input = stageOf({
      agents: [
        leader,
        member('tab-1:leaf', 'working'),
        member('tab-2:leaf', 'waiting'),
        member('tab-3:leaf', 'idle'),
        member('tab-4:leaf', 'done', { review: { state: 'merged', number: 4, url: 'u' } })
      ]
    }).input
    const activity = new Map(input.members.map((one) => [one.key, one.activity]))
    expect(activity).toEqual(
      new Map([
        ['tab-1:leaf', 'working'],
        ['tab-2:leaf', 'needsYou'],
        ['tab-3:leaf', 'resting'],
        ['tab-4:leaf', 'done']
      ])
    )
    expect(input.lead.activity).toBe('working')
  })

  it('names every figure as its Team card does', () => {
    const input = stageOf({
      agents: [leader, member('tab-1:leaf', 'working', { displayName: 'Toadette · ORCA-1216' })]
    }).input
    expect(input.members.map((one) => one.name)).toEqual(['Toadette'])
  })

  it('brings the advisor on stage when the lead has Jev, with its line', () => {
    const input = stageOf({
      agents: [
        {
          ...leader,
          advisor: {
            model: null,
            effort: null,
            pinned: { model: false, effort: false },
            line: 'Ship it'
          }
        },
        member('tab-1:leaf')
      ]
    }).input
    expect(input.advisor).toEqual({ line: 'Ship it' })
  })

  it('draws every member, as the desktop stage does with its +N', () => {
    const many = Array.from({ length: 11 }, (_, at) => member(`tab-${at + 1}:leaf`))
    expect(stageOf({ agents: [leader, ...many] }).input.members).toHaveLength(11)
  })

  it('reads an older host with no panel as the readable band', () => {
    expect(sceneOf({ panel: undefined })?.kind).toBe('readable')
  })

  it("keeps Orca's office in a themed scene, as the desktop does", () => {
    expect(
      stageOf({ config: { scene: 'night-watch' }, panel: panel('game', 'office') }).art
    ).toEqual({ kind: 'bundled', style: 'office' })
  })

  it('draws a themed scene in Figures as its Pixel stage, as the desktop does', () => {
    expect(stageOf({ config: { scene: 'night-watch' } }).art).toEqual({
      kind: 'pixel',
      sceneId: 'night-watch'
    })
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
  it('offers the scene file art on a host that serves it, with the stage it falls back to', () => {
    const band = stageOf(mario, true)
    expect(band.art).toMatchObject({ kind: 'scene', style: 'figures', sceneId: 'mario' })
    expect(band.art.kind === 'scene' && band.art.native.roles.lead.sheets).toEqual(['mario.png'])
    expect(band.fallback).toEqual({ kind: 'pixel', sceneId: 'mario' })
    expect(band.scenes.map((one) => one.id)).toEqual(['mario'])
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
    expect(stageOf(office, true).fallback).toEqual({ kind: 'bundled', style: 'office' })
    expect(stageOf(office).art).toEqual({ kind: 'bundled', style: 'office' })
  })

  it("never asks a host without mobile.team-scene.v1 for the scene's own art", () => {
    expect(stageOf(mario).art).toEqual({ kind: 'pixel', sceneId: 'mario' })
  })
})
