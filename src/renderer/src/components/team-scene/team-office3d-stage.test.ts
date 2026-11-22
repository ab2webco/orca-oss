import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamHost, TeamMemberCard } from '../../../../shared/team-panel-model-types'
import {
  OFFICE3D_DEPTH,
  OFFICE3D_DOOR_Z,
  OFFICE3D_PITCH,
  teamOffice3dLayoutOf
} from '../../../../shared/team-scene/team-office3d-layout'
import type { TeamSceneFloor } from '../../../../shared/team-scene/team-scene-floors'
import type {
  TeamSceneInput,
  TeamSceneMemberInput
} from '../../../../shared/team-scene/team-scene-types'
import { dioramaPan, dioramaView, dioramaZoomBy, type DioramaView } from './team-diorama-view'
import {
  office3dTraffic,
  office3dTrafficRead,
  type Office3dTraffic
} from '../../../../shared/team-scene/team-office3d-traffic'
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
    clear: vi.fn(),
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
  view?: DioramaView,
  /** A member whose CI turns red between two reads: the event that sends the lead out. */
  redCi?: string
) => {
  const r = renderer()
  const layout = teamOffice3dLayoutOf(floors, { leadAdvisor })
  let traffic: Office3dTraffic | undefined
  if (redCi) {
    traffic = office3dTraffic()
    office3dTrafficRead(traffic, layout, input(members), 0, 'normal')
    const red = members.map((m) =>
      m.key === redCi ? { ...m, activity: 'done' as const, ci: 'failure' as const } : m
    )
    office3dTrafficRead(traffic, layout, input(red), 0, 'normal')
  }
  const stage = office3dStage(r.fake, {
    width: 350,
    dark: false,
    status,
    input: input(members),
    layout,
    pace: 'normal',
    words: { thisMachine: 'This Mac', offline: 'Offline' },
    ...(view ? { view } : {}),
    ...(traffic ? { traffic } : {})
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
  // Why: the phone rebuilds the stage on every read, in a WebView with a hard memory cap (ORCA-1334).
  it("frees every texture it made and the sun's shadow when disposed, and keeps the shared ones", () => {
    // Why a stand-in canvas: without a 2D canvas the screens, chips and lift make no texture.
    const g = new Proxy({} as Record<string | symbol, unknown>, {
      get: (own, key) =>
        key in own ? own[key] : () => ({ width: 8, addColorStop: () => undefined })
    })
    const canvas = { width: 0, height: 0, getContext: () => g }
    Object.assign(globalThis, { document: { createElement: () => canvas } })
    const built = (() => {
      try {
        return stageOf([member('a', 'working')], [floor('', ['a']), floor('m2', [])])
      } finally {
        Reflect.deleteProperty(globalThis, 'document')
      }
    })()
    const { stage, scenes } = built
    stage.draw(0)
    const textures = new Set<THREE.Texture>()
    const suns: THREE.DirectionalLight[] = []
    scenes[0]!.traverse((o) => {
      if (o instanceof THREE.DirectionalLight) {
        suns.push(o)
      }
      for (const material of [(o as THREE.Mesh).material ?? []].flat()) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) {
            textures.add(value)
          }
        }
      }
    })
    const freed = new Set<THREE.Texture>()
    for (const one of textures) {
      one.addEventListener('dispose', () => freed.add(one))
    }
    const own = [...textures].filter((one) => !one.userData.shared)
    expect(own.length).toBeGreaterThan(3)
    const sunGone = vi.spyOn(suns[0]!, 'dispose')
    stage.dispose()
    expect(own.filter((one) => !freed.has(one))).toEqual([])
    expect([...freed].filter((one) => one.userData.shared)).toEqual([])
    expect(sunGone).toHaveBeenCalled()
  })

  it("caps the shadow map where the client asks, and keeps the desktop's 2048 otherwise", () => {
    const sunOf = (limits?: { pixelRatio: number; shadowMap: number }) => {
      const r = renderer()
      office3dStage(r.fake, {
        width: 350,
        dark: false,
        status,
        input: input([member('a', 'working')]),
        layout: teamOffice3dLayoutOf([floor('', ['a'])], { leadAdvisor: false }),
        pace: 'normal',
        words: { thisMachine: 'This Mac', offline: 'Offline' },
        ...(limits ? { limits } : {})
      }).draw(0)
      let sun: THREE.DirectionalLight | null = null
      r.scenes[0]!.traverse((o) => {
        sun = o instanceof THREE.DirectionalLight ? o : sun
      })
      return (sun as THREE.DirectionalLight | null)!.shadow.mapSize.x
    }
    expect(sunOf({ pixelRatio: 1.5, shadowMap: 1024 })).toBe(1024)
    expect(sunOf()).toBe(2048)
  })

  it('sizes the canvas to the panel width and draws a frame', () => {
    const { stage, scenes, setSize } = stageOf([member('a', 'working')], [floor('', ['a'])])
    expect(setSize).toHaveBeenCalledWith(350, stage.height, true)
    expect(stage.height).toBeGreaterThan(0)
    stage.draw(1)
    // One pass for the lobby, one for this machine's floor, one for the lift shaft.
    expect(scenes).toHaveLength(3)
    stage.dispose()
  })

  it('draws each floor in its own pass, so nothing upstairs shadows the floor below', () => {
    const { stage, fake } = stageOf(
      [member('a', 'working'), member('b', 'resting')],
      [floor('', ['a', 'b']), floor('m2', [])]
    )
    const passes: Set<number>[] = []
    const draw = fake.render.bind(fake)
    fake.render = (scene: THREE.Scene, camera: THREE.Camera) => {
      const world = scene.children.find((o) => o.type === 'Group')!
      const floors = new Set<number>()
      for (const part of world.children) {
        // Only what casts or receives the sun's shadow; the shaft is drawn apart.
        if (part.visible && !part.userData.office3dAcross) {
          floors.add(Math.floor((part.position.y + 2) / OFFICE3D_PITCH))
        }
      }
      passes.push(floors)
      draw(scene, camera)
    }
    stage.draw(1)
    // The lobby, this machine's floor with its members, m2's floor, and the shaft on its own.
    expect(passes.filter((p) => p.size > 0).map((p) => [...p])).toEqual([[0], [1], [2]])
    expect(passes).toHaveLength(4)
  })

  it('fits the whole building into an asked height under 220, and says its full height', () => {
    const r = renderer()
    const members = [member('a', 'working')]
    const layout = teamOffice3dLayoutOf([floor('', ['a'])], { leadAdvisor: false })
    const args = { dark: false, status, input: input(members), layout, pace: 'normal' }
    const words = { thisMachine: 'This Mac', offline: 'Offline' }
    const open = office3dStage(r.fake, { ...args, words, width: 280 })
    const small = office3dStage(r.fake, { ...args, words, width: 280, height: 176 })
    expect(small.height).toBe(176)
    expect(r.setSize).toHaveBeenLastCalledWith(280, 176, true)
    expect(small.full).toBe(open.height)
    expect(open.full).toBeGreaterThan(176)
    // Following the lead in that small stage, a floor's chip keeps its size on screen.
    const view = dioramaView()
    const near = office3dStage(r.fake, { ...args, words, width: 280, height: 176, view })
    for (let t = 0; t < 6; t += 0.2) {
      near.draw(t)
    }
    const camera = r.cameras.at(-1)!
    expect(camera.zoom).toBeGreaterThan(1.5)
    const pxPerUnit = (280 / (camera.right - camera.left)) * camera.zoom
    const chips: THREE.Sprite[] = []
    r.scenes
      .at(-1)!
      .traverse((o) => o instanceof THREE.Sprite && o.userData.aspect && chips.push(o))
    expect(chips.length).toBeGreaterThan(0)
    for (const chip of chips) {
      expect(chip.scale.y * pxPerUnit).toBeGreaterThanOrEqual(20 - 1e-6)
      expect(chip.scale.y * pxPerUnit).toBeLessThan(30)
    }
  })

  it('sends the lead up the lift to a member on another floor whose CI went red', () => {
    const { stage, scenes } = stageOf(
      [member('a', 'working'), member('c', 'working')],
      [floor('', ['a']), floor('m2', ['c'])],
      false,
      undefined,
      'c'
    )
    const heights = new Set<number>()
    for (let t = 0; t < 60; t += 0.5) {
      stage.draw(t)
      heights.add(Math.round(leadOf(scenes.at(-1)!)!.position.y / OFFICE3D_PITCH))
    }
    // Floor 0 is the lobby: the lead's floor is 1, the asker's 2.
    expect([...heights].sort()).toEqual([1, 2])
  })

  it('keeps the lead on its own floor when nobody elsewhere needs the user', () => {
    const { stage, scenes } = stageOf(
      [member('a', 'working'), member('c', 'working')],
      [floor('', ['a']), floor('m2', ['c'])]
    )
    for (let t = 0; t < 60; t += 0.5) {
      stage.draw(t)
      expect(leadOf(scenes.at(-1)!)!.position.y).toBeLessThan(OFFICE3D_PITCH * 1.5)
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
    // Its two floors and the lobby.
    expect(sprites).toHaveLength(3)
    for (const chip of sprites) {
      expect(chip.position.z).toBeGreaterThan(OFFICE3D_DEPTH)
    }
    expect(leftmost).toBeLessThan(-2)
  })

  // The owner: the Office must pan, zoom and follow the lead like Figures (ORCA-1302).
  it('follows the lead with the camera, up the lift and onto its floor', () => {
    const view = dioramaView()
    const { stage, scenes } = stageOf(
      [member('a', 'working'), member('c', 'working')],
      [floor('', ['a']), floor('m2', ['c'])],
      false,
      view,
      'c'
    )
    let aimedUp = false
    let leadUp = false
    for (let t = 0; t < 60; t += 0.25) {
      stage.draw(t)
      const lead = leadOf(scenes.at(-1)!)!.getWorldPosition(new THREE.Vector3())
      expect(view.target!.distanceTo(lead), `camera lost the lead at ${t}`).toBeLessThan(12)
      aimedUp ||= view.target!.y > OFFICE3D_PITCH / 2
      leadUp ||= lead.y > OFFICE3D_PITCH / 2
    }
    expect(leadUp, 'the lead never rode up').toBe(true)
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

  it('slides the lift doors open while the lead walks through them, and shut after', () => {
    const { stage, scenes } = stageOf(
      [member('a', 'working'), member('c', 'working')],
      [floor('', ['a']), floor('m2', ['c'])],
      false,
      undefined,
      'c'
    )
    // The leaves are the two thin boxes at the door plane, on the floor the lead stands on.
    const leavesAt = (scene: THREE.Scene, y: number) => {
      const out: THREE.Object3D[] = []
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        const p = m.getWorldPosition(new THREE.Vector3())
        if (m.isMesh && Math.abs(p.x + 0.08) < 1e-6 && Math.abs(p.y - (y + 1.38)) < 1e-6) {
          out.push(m)
        }
      })
      return out
    }
    let passed = 0
    for (let t = 0; t < 60; t += 0.1) {
      stage.draw(t)
      const scene = scenes.at(-1)!
      const lead = leadOf(scene)!.getWorldPosition(new THREE.Vector3())
      const y = Math.round(lead.y / OFFICE3D_PITCH) * OFFICE3D_PITCH
      if (lead.x > -0.3 && lead.x < 0.15 && Math.abs(lead.y - y) < 0.5) {
        passed += 1
        const gap = leavesAt(scene, y).map((l) => Math.abs(l.position.z - OFFICE3D_DOOR_Z))
        // Open means both leaves are out of the opening (z 3.26..4.94) and inside the wall,
        // never slid out past the building's front.
        for (const leaf of leavesAt(scene, y)) {
          expect(
            leaf.position.z + 0.42,
            `a leaf still in the doorway at ${t.toFixed(1)}`
          ).toBeLessThan(3.3)
          expect(leaf.position.z - 0.42).toBeGreaterThan(0)
        }
        void gap
      }
    }
    expect(passed, 'the lead never passed the lift door').toBeGreaterThan(0)
  })

  // The owner: every agent sits on its own chair, centred, facing its monitor (ORCA-1302).
  it('seats every member, the lead and each advisor on a chair, facing their screen', () => {
    const view = {
      members: [member('a', 'working'), member('b', 'resting'), member('c', 'needsYou')]
    }
    const floors = [floor('', ['a', 'b'], true), floor('m2', ['c'], true)]
    const { stage, scenes } = stageOf(view.members, floors, true)
    // The lead sits at its desk once its round ends.
    stage.draw(0)
    const scene = scenes.at(-1)!
    const cushions: THREE.Vector3[] = []
    const sitters: THREE.Object3D[] = []
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      const g = m.geometry as THREE.CylinderGeometry | undefined
      if (m.isMesh && g?.type === 'CylinderGeometry' && g.parameters.radiusTop === 0.4) {
        cushions.push(m.getWorldPosition(new THREE.Vector3()))
      }
      if (o.userData.seated) {
        sitters.push(o)
      }
    })
    const seated = sitters
    // a, b, c at desks, an advisor on each floor; the lead walks at t=0 so it is checked below.
    expect(seated.length).toBeGreaterThanOrEqual(5)
    for (const f of seated) {
      const p = f.position
      const chair = cushions.find(
        (c) => Math.hypot(c.x - p.x, c.z - p.z) < 0.05 && Math.abs(c.y - p.y) < 2
      )
      expect(
        chair,
        `${f.userData.seated} sits off its chair at ${p.x.toFixed(2)},${p.z.toFixed(2)}`
      ).toBeTruthy()
      const hip = f.children
        .find((c) => c.type === 'Group' && Math.abs(c.position.y - 0.34) < 1e-6)!
        .getWorldPosition(new THREE.Vector3())
      // Hips on the cushion's top (its centre + 0.06), never sunk into it or the floor.
      expect(
        Math.abs(hip.y - (chair!.y + 0.06)),
        `${f.userData.seated} sits at the wrong height`
      ).toBeLessThan(0.08)
    }
    for (const f of seated.filter((f) => f.userData.seated === 'member')) {
      expect(f.rotation.y).toBeCloseTo(Math.PI)
    }
    // The lead, whenever its round sits it at its desk.
    let atDesk = 0
    for (let t = 0; t < 80; t += 0.5) {
      stage.draw(t)
      const lead = leadOf(scenes.at(-1)!)!
      if (lead.userData.seated === 'lead') {
        atDesk += 1
        const p = lead.position
        expect(
          cushions.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 0.05),
          `lead off its chair at ${t}`
        ).toBe(true)
      }
    }
    expect(atDesk, 'the lead never sat at its desk').toBeGreaterThan(0)
  })

  it('lights the call panel while the lead waits for the cab, and darkens it when the cab arrives', () => {
    const { stage, scenes } = stageOf(
      [member('a', 'working'), member('c', 'working')],
      [floor('', ['a']), floor('m2', ['c'])],
      false,
      undefined,
      'c'
    )
    let lit = 0
    let darkOnArrival = 0
    for (let t = 0; t < 60; t += 0.1) {
      stage.draw(t)
      const scene = scenes.at(-1)!
      const buttons: THREE.Mesh[] = []
      scene.traverse((o) => {
        if (o.userData.callButton !== undefined) {
          buttons.push(o as THREE.Mesh)
        }
      })
      // A panel on every floor, the lobby's too.
      expect(buttons).toHaveLength(3)
      const on = buttons.filter((b) => b.userData.lit).length
      lit += on
      const lead = leadOf(scene)!.getWorldPosition(new THREE.Vector3())
      // In the cab: no floor's call is pending any more.
      if (lead.x < -0.6) {
        darkOnArrival += 1
        expect(on, `a call stayed lit with the lead in the cab at ${t.toFixed(1)}`).toBe(0)
      }
    }
    expect(lit, 'the call panel never lit').toBeGreaterThan(0)
    expect(darkOnArrival).toBeGreaterThan(0)
  })

  it('keeps the followed view inside the building, never past its bottom or sides', () => {
    const view = dioramaView()
    const { stage, cameras, scenes } = stageOf(
      [member('a', 'working'), member('c', 'needsYou')],
      [floor('', ['a']), floor('m2', ['c']), floor('gpu', [])],
      false,
      view
    )
    for (let t = 0; t < 40; t += 1 / 30) {
      stage.draw(t)
    }
    const cam = cameras.at(-1)!
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1)
    const box = new THREE.Box3()
    // The building: solid meshes only, as the camera fit counts them.
    scenes.at(-1)!.traverse((o) => {
      const m = o as THREE.Mesh
      const mat = m.material as THREE.Material | undefined
      if (m.isMesh && mat && !mat.transparent && m.geometry.type !== 'PlaneGeometry') {
        box.union(new THREE.Box3().setFromObject(m))
      }
    })
    const corners = [box.min, box.max].flatMap((a) =>
      [box.min.y, box.max.y].flatMap((y) =>
        [box.min.z, box.max.z].map((z) => new THREE.Vector3(a.x, y, z))
      )
    )
    const ups = corners.map((c) => c.dot(up))
    const rights = corners.map((c) => c.dot(right))
    const t = view.target!
    const halfH = cam.top / cam.zoom
    const halfW = cam.right / cam.zoom
    expect(t.dot(up) - halfH, 'frame runs past the bottom').toBeGreaterThanOrEqual(
      Math.min(...ups) - 0.5
    )
    expect(t.dot(right) - halfW, 'frame runs past the left').toBeGreaterThanOrEqual(
      Math.min(...rights) - 0.5
    )
    expect(t.dot(right) + halfW, 'frame runs past the right').toBeLessThanOrEqual(
      Math.max(...rights) + 0.5
    )
  })

  // ORCA-1317: members go where their state sends them, and pairs play together.
  describe('members on the move', () => {
    const team = (resting: string[]) =>
      ['a', 'b', 'c', 'd', 'e', 'f'].map((k) =>
        member(k, resting.includes(k) ? 'resting' : 'working')
      )
    const floors = () => [floor('', ['a', 'b']), floor('m2', ['c', 'd', 'e', 'f'])]
    const drawAt = (resting: string[], t: number) => {
      const r = renderer()
      const layout = teamOffice3dLayoutOf(floors(), { leadAdvisor: false })
      const traffic = office3dTraffic()
      office3dTrafficRead(traffic, layout, input(team([])), 0, 'normal')
      office3dTrafficRead(traffic, layout, input(team(resting)), 1, 'normal')
      const stage = office3dStage(r.fake, {
        width: 350,
        dark: false,
        status,
        input: input(team(resting)),
        layout,
        pace: 'normal',
        words: { thisMachine: 'This Mac', offline: 'Offline' },
        traffic
      })
      stage.draw(t)
      return r.scenes.at(-1)!
    }
    const ballOf = (scene: THREE.Scene) => {
      let ball: THREE.Object3D | null = null
      scene.traverse((o) => {
        const g = (o as THREE.Mesh).geometry as THREE.SphereGeometry | undefined
        if (g?.type === 'SphereGeometry' && g.parameters.radius === 0.06) {
          ball = o
        }
      })
      return ball as THREE.Object3D | null
    }

    it('opens the doors and lights the panel for a member riding alone, the lead at its desk', () => {
      const r = renderer()
      const layout = teamOffice3dLayoutOf(floors(), { leadAdvisor: false })
      const traffic = office3dTraffic()
      office3dTrafficRead(traffic, layout, input(team([])), 0, 'normal')
      office3dTrafficRead(traffic, layout, input(team(['c'])), 1, 'normal')
      const stage = office3dStage(r.fake, {
        width: 350,
        dark: false,
        status,
        input: input(team(['c'])),
        layout,
        pace: 'normal',
        words: { thisMachine: 'This Mac', offline: 'Offline' },
        traffic
      })
      const litOn = new Set<number>()
      const openOn = new Set<number>()
      for (let t = 1; t < 40; t += 0.1) {
        stage.draw(t)
        expect(leadOf(r.scenes.at(-1)!)!.userData.seated, 'the lead left its desk').toBe('lead')
        r.scenes.at(-1)!.traverse((o) => {
          if (o.userData.callButton !== undefined && o.userData.lit) {
            litOn.add(o.userData.callButton as number)
          }
          const m = o as THREE.Mesh
          const p = m.getWorldPosition(new THREE.Vector3())
          // A leaf is open once it slid out of its shut place into the wall.
          if (m.isMesh && Math.abs(p.x + 0.08) < 1e-6 && Math.abs(p.z - OFFICE3D_DOOR_Z) > 0.6) {
            openOn.add(Math.round(p.y / OFFICE3D_PITCH))
          }
        })
      }
      // c calls from m2's floor (2) and leaves the cab in the lobby (0).
      expect([...litOn]).toEqual([2])
      expect([...openOn].sort()).toEqual([0, 2])
    })

    it('draws a member with nothing to do in the lobby, not at its desk', () => {
      const scene = drawAt(['c'], 400)
      const inLobby: THREE.Object3D[] = []
      scene.traverse((o) => {
        if (
          o.type === 'Group' &&
          Math.abs(o.scale.x - 1.6) < 1e-3 &&
          o.visible &&
          o.position.y < OFFICE3D_PITCH / 2
        ) {
          inLobby.push(o)
        }
      })
      expect(inLobby).toHaveLength(1)
    })

    it('flies the table-tennis ball only while two hold the paddles', () => {
      // Two at the console first, then the paddles: four free members fill both.
      expect(ballOf(drawAt(['c', 'd', 'e', 'f'], 400))?.visible).toBe(true)
      expect(ballOf(drawAt(['c', 'd', 'e'], 400))?.visible).toBe(false)
    })
  })
})
