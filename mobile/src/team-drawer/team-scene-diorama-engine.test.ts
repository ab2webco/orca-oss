import { describe, expect, it, vi } from 'vitest'
import type { Office3dFloorInput } from '../../../src/shared/team-scene/team-office3d-layout'
import type { TeamSceneInput } from '../../../src/shared/team-scene/team-scene-types'
import { createTeamSceneDioramaEngine } from './team-scene-diorama-engine'
import type { TeamSceneEngineEvent, TeamSceneEngineStage } from './team-scene-engine-messages'

type Built = {
  kind: 'figures' | 'office'
  args: Record<string, unknown> & { view: { target: unknown } }
  aimAtBuild: unknown
  draws: number
  disposed: number
}

// Why stand-ins: Node has no WebGL; these record what the engine asks each desktop stage to build.
const { built, stageOf } = vi.hoisted(() => {
  const built: Built[] = []
  const stageOf = (kind: Built['kind']) => (_gl: unknown, args: Built['args']) => {
    const one: Built = { kind, args, aimAtBuild: args.view.target, draws: 0, disposed: 0 }
    built.push(one)
    return {
      height: (args.height as number | undefined) ?? 220,
      full: 224,
      draw: () => {
        one.draws++
        args.view.target = kind
      },
      dispose: () => {
        one.disposed++
      }
    }
  }
  return { built, stageOf }
})
vi.mock('../../../src/renderer/src/components/team-scene/team-diorama-stage', () => ({
  dioramaRenderer: () => ({}),
  dioramaStage: stageOf('figures')
}))
vi.mock('../../../src/renderer/src/components/team-scene/team-office3d-stage', () => ({
  office3dStage: stageOf('office')
}))

describe('the phone diorama camera (ORCA-1335)', () => {
  const engine = () => {
    const posted: TeamSceneEngineEvent[] = []
    const one = createTeamSceneDioramaEngine({
      canvas: {} as HTMLCanvasElement,
      width: () => 390,
      dark: () => true,
      scheduler: { request: () => 0, cancel: () => undefined },
      post: (event) => posted.push(event)
    })
    return { one, mode: () => posted.at(-1) }
  }

  it("takes the sheet's buttons, and a finger's pan or pinch frees the camera as on the desktop", () => {
    const { one, mode } = engine()
    one.camera({ kind: 'camera', mode: 'all' })
    expect(mode()).toEqual({ kind: 'camera', mode: 'all' })
    one.camera({ kind: 'camera', pan: [12, -4] })
    expect(mode()).toEqual({ kind: 'camera', mode: 'free' })
    one.camera({ kind: 'camera', mode: 'lead' })
    expect(mode()).toEqual({ kind: 'camera', mode: 'lead' })
    one.camera({ kind: 'camera', zoom: 1.5 })
    expect(mode()).toEqual({ kind: 'camera', mode: 'free' })
  })
})

const officeEngine = () => {
  built.length = 0
  const posted: TeamSceneEngineEvent[] = []
  const one = createTeamSceneDioramaEngine({
    canvas: {} as HTMLCanvasElement,
    width: () => 390,
    dark: () => true,
    scheduler: { request: () => 0, cancel: () => undefined },
    post: (event) => posted.push(event)
  })
  return { one, posted, offices: () => built.filter((one) => one.kind === 'office') }
}

const colors = { attention: '#f00', done: '#a0f', working: '#0f0', risk: '#fa0' }
const stageWith = (over: Partial<TeamSceneEngineStage>): TeamSceneEngineStage => ({
  art: { kind: 'bundled', style: 'office' },
  images: {},
  scenes: [],
  timezone: 'UTC',
  nowMs: 0,
  colors,
  ...over
})
const words = { thisMachine: 'm1', offline: 'Offline', lobby: 'Lobby' }
const office = stageWith({ office3d: { pace: 'normal', words } })
const figures = stageWith({
  art: { kind: 'bundled', style: 'figures' },
  diorama: { quality: 'high', pace: 'normal' }
})
const pixel = stageWith({ art: { kind: 'pixel', sceneId: 'quest' } })

const input: TeamSceneInput = {
  lead: { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' },
  advisor: null,
  members: ['a', 'b'].map((key) => ({
    key,
    name: key,
    characterKey: null,
    activity: 'working' as const,
    reportId: null,
    mergedPr: null,
    site: { stage: 1, broken: false }
  }))
}
const floor = (key: string, paneKey: string): Office3dFloorInput => ({
  key,
  host: key
    ? { kind: 'remote', name: key, environmentId: null, reachable: true }
    : { kind: 'local' },
  members: [{ paneKey }],
  cap: 4,
  running: 1,
  reachable: true,
  lead: key === '',
  taken: 0,
  free: 3
})
const floors = [floor('', 'a'), floor('m2', 'b')]

describe('the 3D Office on the phone (ORCA-1334)', () => {
  it('builds the desktop building from the floors it is sent, and keeps its traffic across reads', () => {
    const { one, posted, offices } = officeEngine()
    one.motion(true, false)
    expect(one.take(office)).toBe(true)
    one.input(input, undefined, floors)
    const [first] = offices()
    const layout = first!.args.layout as { floors: { key: string }[] }
    expect(layout.floors.map((f) => f.key)).toEqual(['@lobby', '', 'm2'])
    expect(first!.args.words).toEqual(words)
    // Why 224: the desktop opens two machines at two floor strips, under the phone's 300 pt cap.
    expect(posted.at(-1)).toEqual({ kind: 'ready', height: 224, camera: 'lead' })
    one.input(input, undefined, floors)
    const [, second] = offices()
    expect(first!.disposed).toBe(1)
    expect(second!.args.traffic).toBe(first!.args.traffic)
  })

  it('waits for the read that carries the floors before it builds the Office', () => {
    const { one, offices } = officeEngine()
    one.motion(true, false)
    one.take(figures)
    one.input(input, undefined)
    const [shown] = built
    one.take(office)
    expect(offices()).toEqual([])
    expect(shown!.disposed).toBe(1)
    one.input(input, undefined, floors)
    expect(offices()).toHaveLength(1)
  })

  it('rebuilds nothing while the sheet rests at its peek, and once when it opens', () => {
    const { one, offices } = officeEngine()
    one.motion(false, false)
    one.take(office)
    one.input(input, undefined, floors)
    // Why the first: an open then draws at once (ORCA-1309); it draws no frame at the peek.
    expect(offices()).toHaveLength(1)
    expect(offices()[0]!.draws).toBe(0)
    for (let i = 0; i < 3; i++) {
      one.input(input, undefined, floors)
    }
    expect(offices()).toHaveLength(1)
    one.motion(true, false)
    expect(offices()).toHaveLength(2)
    expect(offices()[1]!.draws).toBe(1)
  })

  // Why the phone's own caps: no frame rate was measured on a device (lead's call).
  it('draws both 3D scenes at pixel ratio 1.5 and a 1024 shadow map, below the desktop', () => {
    const { one } = officeEngine()
    one.motion(true, false)
    one.take(figures)
    one.input(input, undefined, floors)
    one.take(office)
    expect(built.map((b) => [b.kind, b.args.limits])).toEqual([
      ['figures', { pixelRatio: 1.5, shadowMap: 1024 }],
      ['office', { pixelRatio: 1.5, shadowMap: 1024 }]
    ])
  })

  it("sends the Office's new height while parked, so the band is sized before the sheet opens", () => {
    const { one, posted, offices } = officeEngine()
    one.motion(false, false)
    one.take(office)
    one.input(input, undefined, [floor('', 'a')])
    expect(posted.at(-1)).toMatchObject({ kind: 'ready', height: 176 })
    one.input(input, undefined, floors)
    expect(posted.at(-1)).toMatchObject({ kind: 'ready', height: 224 })
    expect(offices()).toHaveLength(1)
  })

  it('aims the camera afresh when the 3D scene changes, even through a 2D stage', () => {
    const { one, offices } = officeEngine()
    one.motion(true, false)
    one.take(figures)
    one.input(input, undefined, floors)
    expect(built[0]!.args.view.target).not.toBeNull()
    expect(one.take(pixel)).toBe(false)
    one.take(office)
    expect(offices()[0]!.aimAtBuild).toBeNull()
  })
})
