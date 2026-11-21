import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamHost, TeamMemberCard } from '../../../../shared/team-panel-model-types'
import {
  OFFICE3D_DEPTH,
  OFFICE3D_PITCH,
  teamOffice3dLayoutOf
} from '../../../../shared/team-scene/team-office3d-layout'
import type { TeamSceneFloor } from '../../../../shared/team-scene/team-scene-floors'
import type {
  TeamSceneInput,
  TeamSceneMemberInput
} from '../../../../shared/team-scene/team-scene-types'
import { dioramaPan, dioramaView, dioramaZoomBy, type DioramaView } from './team-diorama-view'
import { office3dStage } from './team-office3d-stage'

const status = { attention: '#e40014', done: '#15803d', working: '#0369a1', risk: '#b45309' }
const host = (name: string): TeamHost =>
  name ? { kind: 'remote', name, environmentId: `env-${name}`, reachable: true } : { kind: 'local' }
const floor = (key: string, keys: string[], decided = false): TeamSceneFloor => ({
  key,
  host: host(key),
  members: keys.map(
    (paneKey) =>
      ({
        paneKey,
        decisions: decided ? [{ id: 'd', verdict: 'allow', gesture: null }] : []
      }) as unknown as TeamMemberCard
  ),
  cap: 5,
  running: keys.length,
  reachable: true,
  lead: key === '',
  taken: 0,
  free: 5 - keys.length
})
const member = (key: string, activity: TeamSceneMemberInput['activity']): TeamSceneMemberInput => ({
  key,
  name: key,
  characterKey: null,
  activity,
  reportId: null,
  mergedPr: null,
  site: { stage: 1, broken: false }
})
const input = (members: TeamSceneMemberInput[]): TeamSceneInput => ({
  lead: { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' },
  advisor: null,
  members
})
const renderer = () => {
  const scenes: THREE.Scene[] = []
  const cameras: THREE.OrthographicCamera[] = []
  const fake = {
    shadowMap: { enabled: false },
    setPixelRatio: vi.fn(),
    setClearColor: vi.fn(),
    setSize: vi.fn(),
    render: (scene: THREE.Scene, camera: THREE.OrthographicCamera) => {
      scenes.push(scene)
      cameras.push(camera)
    }
  }
  return { fake: fake as unknown as THREE.WebGLRenderer, scenes, cameras, setSize: fake.setSize }
}
const stageOf = (
  members: TeamSceneMemberInput[],
  floors: TeamSceneFloor[],
  leadAdvisor = false,
  view?: DioramaView
) => {
  const r = renderer()
  const stage = office3dStage(r.fake, {
    width: 350,
    dark: false,
    status,
    input: input(members),
    layout: teamOffice3dLayoutOf(floors, { leadAdvisor }),
    pace: 'normal',
    words: { thisMachine: 'This Mac', offline: 'Offline' },
    ...(view ? { view } : {})
  })
  return { stage, ...r }
}
// The lead is the only figure at the lead's 1.12 scale.
const leadOf = (scene: THREE.Scene) => {
  let lead: THREE.Object3D | null = null
  scene.traverse((o) => {
    if (o.type === 'Group' && Math.abs(o.scale.x - 1.6 * 1.12) < 1e-3) {
      lead = o
    }
  })
  return lead as THREE.Object3D | null
}

vi.stubGlobal('window', { devicePixelRatio: 1 })
afterEach(() => vi.clearAllMocks())

describe('the 3D Office stage', () => {
  it('sizes the canvas to the panel width and draws a frame', () => {
    const { stage, scenes, setSize } = stageOf([member('a', 'working')], [floor('', ['a'])])
    expect(setSize).toHaveBeenCalledWith(350, stage.height, true)
    expect(stage.height).toBeGreaterThan(0)
    stage.draw(1)
    expect(scenes).toHaveLength(1)
    stage.dispose()
  })

  it('sends the lead up the lift to a member that needs the user on another floor', () => {
    const { stage, scenes } = stageOf(
      [member('a', 'working'), member('c', 'needsYou')],
      [floor('', ['a']), floor('m2', ['c'])]
    )
    const heights = new Set<number>()
    for (let t = 0; t < 60; t += 0.5) {
      stage.draw(t)
      heights.add(Math.round(leadOf(scenes.at(-1)!)!.position.y / OFFICE3D_PITCH))
    }
    expect([...heights].sort()).toEqual([0, 1])
  })

  it('keeps the lead on its own floor when nobody elsewhere needs the user', () => {
    const { stage, scenes } = stageOf(
      [member('a', 'working'), member('c', 'working')],
      [floor('', ['a']), floor('m2', ['c'])]
    )
    for (let t = 0; t < 60; t += 0.5) {
      stage.draw(t)
      expect(leadOf(scenes.at(-1)!)!.position.y).toBeLessThan(OFFICE3D_PITCH / 2)
    }
  })

  it('seats an advisor only on floors whose advisor has spoken', () => {
    const count = (floors: TeamSceneFloor[], leadAdvisor: boolean) => {
      const { stage, scenes } = stageOf(
        [member('a', 'working'), member('c', 'working')],
        floors,
        leadAdvisor
      )
      stage.draw(1)
      let n = 0
      scenes[0]!.traverse((o) => {
        n += o.type === 'Group' && Math.abs(o.rotation.y - (Math.PI - 0.35)) < 1e-6 ? 1 : 0
      })
      return n
    }
    expect(count([floor('', ['a']), floor('m2', ['c'])], false)).toBe(0)
    expect(count([floor('', ['a']), floor('m2', ['c'])], true)).toBe(1)
    expect(count([floor('', ['a']), floor('m2', ['c'], true)], true)).toBe(2)
  })

  it('puts every floor label on its slab front, clear of the desks, and the shaft inside the frame', () => {
    const { stage, scenes } = stageOf([member('a', 'working')], [floor('', ['a']), floor('m2', [])])
    stage.draw(1)
    const sprites: THREE.Sprite[] = []
    let leftmost = Infinity
    scenes[0]!.traverse((o) => {
      if ((o as THREE.Sprite).isSprite && o.position.z > OFFICE3D_DEPTH) {
        sprites.push(o as THREE.Sprite)
      }
      if ((o as THREE.Mesh).isMesh) {
        leftmost = Math.min(leftmost, o.getWorldPosition(new THREE.Vector3()).x)
      }
    })
    expect(sprites).toHaveLength(2)
    for (const chip of sprites) {
      expect(chip.position.z).toBeGreaterThan(OFFICE3D_DEPTH)
    }
    expect(leftmost).toBeLessThan(-2)
  })

  // The owner: the Office must pan, zoom and follow the lead like Figures (ORCA-1302).
  it('follows the lead with the camera, up the lift and onto its floor', () => {
    const view = dioramaView()
    const { stage, scenes } = stageOf(
      [member('a', 'working'), member('c', 'needsYou')],
      [floor('', ['a']), floor('m2', ['c'])],
      false,
      view
    )
    let aimedUp = false
    for (let t = 0; t < 60; t += 0.25) {
      stage.draw(t)
      const lead = leadOf(scenes.at(-1)!)!.getWorldPosition(new THREE.Vector3())
      expect(view.target!.distanceTo(lead), `camera lost the lead at ${t}`).toBeLessThan(12)
      aimedUp ||= view.target!.y > OFFICE3D_PITCH / 2
    }
    expect(aimedUp, 'the camera never rode up with the lead').toBe(true)
  })

  it('frames the whole building on Show all, and stays where the viewer moved it', () => {
    const view = dioramaView()
    const { stage, cameras } = stageOf(
      [member('a', 'working')],
      [floor('', ['a']), floor('m2', [])],
      false,
      view
    )
    stage.draw(0)
    const following = cameras.at(-1)!.zoom
    expect(following).toBeGreaterThan(1)
    view.mode = 'all'
    for (let t = 0.1; t < 8; t += 0.1) {
      stage.draw(t)
    }
    expect(cameras.at(-1)!.zoom).toBeCloseTo(1, 1)
    dioramaPan(view, 120, 0)
    dioramaZoomBy(view, 2)
    expect(view.mode).toBe('free')
    const goal = view.goal.clone()
    for (let t = 8; t < 16; t += 0.1) {
      stage.draw(t)
    }
    expect(view.target!.distanceTo(goal)).toBeLessThan(0.5)
    expect(cameras.at(-1)!.zoom).toBeGreaterThan(1.5)
  })
})
