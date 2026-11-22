import { describe, expect, it } from 'vitest'
import { teamLeadViewOf } from './team-drawer-model'
import { teamSceneBandShown } from './team-scene-band'

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
  tabs: { prs: true, machines: true },
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

  it("shows a working member's monitor by what it really runs, never a plan for a Bash run", () => {
    const input = stageOf({
      agents: [
        leader,
        member('tab-1:leaf', 'working', { toolName: 'Bash', toolInput: 'pnpm vitest run' }),
        member('tab-2:leaf', 'working', { toolName: 'Bash', toolInput: 'ls src' })
      ]
    }).input
    const desk = new Map(input.members.map((one) => [one.key, one.desk]))
    expect(desk.get('tab-1:leaf')).toEqual({ kind: 'tests' })
    expect(desk.get('tab-2:leaf')).toBeUndefined()
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

  it("draws the launch STOP's sign when the project is stopped", () => {
    expect(stageOf({ stopped: { since: 'x', by: 'lead' } }).input.stopped).toBe(true)
    expect(stageOf().input.stopped).toBeUndefined()
  })

  // ORCA-1296: the phone draws Figures as the diorama only when the host's panel does.
  it("asks for the diorama with the host's quality and pace, and keeps 2D for an older host", () => {
    const diorama = { ...panel('game', 'figures'), diorama: true, quality: 'low', pace: 'direct' }
    expect(stageOf({ panel: diorama }).diorama).toEqual({ quality: 'low', pace: 'direct' })
    expect(stageOf({ panel: { ...diorama, quality: 'ultra', pace: undefined } }).diorama).toEqual({
      quality: 'high',
      pace: 'normal'
    })
    expect(stageOf().diorama).toBeUndefined()
    expect(stageOf({ panel: { ...diorama, style: 'office' } }).diorama).toBeUndefined()
  })

  // ORCA-1334: the phone draws the 3D Office only for a host that says it draws it so.
  describe('the 3D Office', () => {
    const office = { ...panel('game', 'office'), quality: 'high', pace: 'fast' }
    const hostCapacity = [
      { host: 'local', status: 'ok', running: 2, cap: 4 },
      { host: 'imac', status: 'ok', running: 0, cap: 2 },
      { host: 'contabo', status: 'unreachable', running: 0 }
    ]

    // Why the host's word: a host older than the 3D Office also says office and high (ORCA-1334).
    it("asks for it, with each machine's floor, cap and reach, only where the host says it draws it", () => {
      const agents = [
        leader,
        member('tab-1:leaf'),
        member('tab-2:leaf', 'working', { remote: { host: 'imac', stateKnown: true } }),
        member('tab-3:leaf', 'working', { remote: { host: 'contabo', stateKnown: true } })
      ]
      const band = stageOf({ panel: { ...office, office3d: true }, hostCapacity, agents })
      expect(band.office3d?.pace).toBe('fast')
      expect(
        band.office3d?.floors.map((one) => [one.key, one.lead, one.cap, one.reachable])
      ).toEqual([
        ['', true, 4, true],
        ['imac', false, 2, true],
        ['contabo', false, null, false]
      ])
      // Why only pane and decisions: a summary or PR change must not resend and rebuild the building.
      expect(band.office3d?.floors[0]!.members).toEqual([
        { paneKey: 'tab-1:leaf', decisions: undefined }
      ])
      expect(stageOf({ panel: office, hostCapacity, agents }).office3d).toBeUndefined()
      expect(stageOf({ panel: { ...office, office3d: 'yes' }, agents }).office3d).toBeUndefined()
    })
  })

  it('names an island per machine its members run on, this one first', () => {
    const machines = stageOf({
      agents: [
        leader,
        member('tab-1:leaf'),
        member('tab-2:leaf', 'working', { remote: { host: 'm2', stateKnown: true } })
      ]
    }).machines
    expect(machines.map((one) => [one.home, one.members])).toEqual([
      [true, ['tab-1:leaf']],
      [false, ['tab-2:leaf']]
    ])
  })

  it('reads an older host with no panel as the readable band', () => {
    expect(sceneOf({ panel: undefined })?.kind).toBe('readable')
  })

  it("keeps Orca's office in a themed scene, as the desktop does", () => {
    expect(
      stageOf({ config: { scene: 'night-watch' }, panel: panel('game', 'office') }).art
    ).toEqual({ kind: 'bundled', style: 'office' })
  })

  // ORCA-1296: Figures is Orca's own art whatever the scene, on the desktop and here.
  it("keeps Orca's Figures in a themed scene, as the desktop does", () => {
    expect(stageOf({ config: { scene: 'night-watch' } }).art).toEqual({
      kind: 'bundled',
      style: 'figures'
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
  it("draws Orca's Figures even where the host serves the scene file's own art", () => {
    const band = stageOf(mario, true)
    expect(band.art).toEqual({ kind: 'bundled', style: 'figures' })
    expect(band.fallback).toEqual({ kind: 'bundled', style: 'figures' })
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

  it("draws Orca's Figures on a host without mobile.team-scene.v1 too", () => {
    expect(stageOf(mario).art).toEqual({ kind: 'bundled', style: 'figures' })
  })
})

describe('whether the open sheet still shows the scene band', () => {
  it('shows it until the sheet scrolls past its bottom edge', () => {
    expect(teamSceneBandShown(0, 200)).toBe(true)
    expect(teamSceneBandShown(199, 200)).toBe(true)
    expect(teamSceneBandShown(200, 200)).toBe(false)
    expect(teamSceneBandShown(640, 200)).toBe(false)
  })

  it('counts it shown before it is laid out', () => {
    expect(teamSceneBandShown(640, null)).toBe(true)
  })
})
