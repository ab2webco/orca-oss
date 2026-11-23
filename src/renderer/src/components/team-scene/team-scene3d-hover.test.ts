import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTeamSceneHover } from './team-scene-hit'
import { linkScene3dHover, type Scene3dHoverHold } from './team-scene3d-hover'
import { scene3dHoverMark, scene3dPick } from './team-scene3d-pick'

const figure = (x: number): THREE.Group => {
  const g = new THREE.Group()
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 2, 0.8), new THREE.MeshBasicMaterial()))
  g.position.set(x, 0, 0)
  g.updateMatrixWorld(true)
  return g
}
// Why orthographic: the diorama's camera is one (team-diorama-camera.ts), so the ray path matches.
const camera = () => {
  const c = new THREE.OrthographicCamera(-6, 6, 3, -3, 0.1, 100)
  c.position.set(0, 1, 12)
  c.lookAt(0, 1, 0)
  c.updateMatrixWorld(true)
  return c
}
/** Where `p` lands on a 200 x 100 canvas. */
const screenOf = (p: THREE.Vector3, c: THREE.Camera) => {
  const n = p.clone().project(c)
  return { x: ((n.x + 1) / 2) * 200, y: ((1 - n.y) / 2) * 100 }
}

describe('picking a 3D figure', () => {
  const figures = new Map([
    ['lead', figure(-3)],
    ['a', figure(0)],
    ['b', figure(3)]
  ])

  it('names the figure under the pointer, and none over empty ground', () => {
    const c = camera()
    for (const [key, f] of figures) {
      const at = screenOf(f.position.clone().setY(1), c)
      expect(scene3dPick(c, figures, at, { width: 200, height: 100 })).toBe(key)
    }
    expect(scene3dPick(c, figures, { x: 100, y: 2 }, { width: 200, height: 100 })).toBeNull()
  })
})

describe('the lit mark under a 3D figure', () => {
  it('rings the lit figure in the working colour, hidden by its body rather than drawn over it', () => {
    const parent = new THREE.Group()
    const mark = scene3dHoverMark(parent, '#0369a1')
    const f = figure(3)
    mark.place(null)
    expect(mark.ring.visible).toBe(false)
    mark.place(f)
    expect(mark.ring.visible).toBe(true)
    expect(mark.ring.position.x).toBeCloseTo(3)
    const m = mark.ring.material as THREE.MeshBasicMaterial
    expect(m.color.getHexString()).toBe('0369a1')
    // Why: drawn over everything, the ring's far arc crossed the figure's waist (owner review).
    expect(m.depthTest).toBe(true)
  })

  it('lies on the surface a raised figure stands on, centred under its feet, inside its neighbours', () => {
    // The world the ring hangs in is offset, and the figure stands on a booth 1.2 above the ground.
    const world = new THREE.Group()
    world.position.set(-2, 0.5, 1)
    const booth = new THREE.Group()
    booth.position.set(4, 1.2, -1)
    world.add(booth)
    const lit = figure(0)
    const next = figure(1)
    booth.add(lit, next)
    world.updateMatrixWorld(true)
    const mark = scene3dHoverMark(world, '#0369a1')
    mark.place(lit, [lit, next])
    mark.ring.updateMatrixWorld(true)

    const feet = lit.getWorldPosition(new THREE.Vector3())
    const ring = mark.ring.getWorldPosition(new THREE.Vector3())
    expect(ring.x).toBeCloseTo(feet.x)
    expect(ring.z).toBeCloseTo(feet.z)
    expect(ring.y).toBeGreaterThanOrEqual(feet.y)
    expect(ring.y).toBeLessThan(feet.y + 0.1)
    // Its outer edge stops before halfway to the next figure, so it never rings two.
    const outer = new THREE.Box3().setFromObject(mark.ring).getSize(new THREE.Vector3()).x / 2
    expect(outer).toBeLessThan(0.5)
    expect(outer).toBeGreaterThan(0.2)
  })
})

describe('linking the Team list and the 3D figures', () => {
  afterEach(() => useTeamSceneHover.getState().set(null))
  const hold = (): Scene3dHoverHold => ({ own: null, down: null })
  const canvas = () => {
    const el = new EventTarget() as EventTarget & { getBoundingClientRect: () => DOMRect }
    el.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 100 }) as DOMRect
    return el
  }
  const fire = (el: EventTarget, type: string, x: number, y: number) =>
    el.dispatchEvent(
      Object.assign(new Event(type), { clientX: x, clientY: y, pointerType: 'mouse', buttons: 0 })
    )

  it('lights the row of the figure under the pointer, and clears it on leaving', () => {
    const el = canvas()
    const pick = vi.fn((p: { x: number; y: number }) => (p.x < 100 ? 'a' : null))
    const stop = linkScene3dHover({ el, pick, light: () => {}, open: () => {}, hold: hold() })
    fire(el, 'pointermove', 60, 50)
    expect(pick).toHaveBeenLastCalledWith({ x: 50, y: 30 }, { width: 200, height: 100 })
    expect(useTeamSceneHover.getState().key).toBe('a')
    fire(el, 'pointerleave', 0, 0)
    expect(useTeamSceneHover.getState().key).toBeNull()
    stop()
  })

  it('marks the figure of the row the pointer is on, and follows it off', () => {
    const light = vi.fn()
    const stop = linkScene3dHover({
      el: canvas(),
      pick: () => null,
      light,
      open: () => {},
      hold: hold()
    })
    expect(light).toHaveBeenLastCalledWith(null)
    useTeamSceneHover.getState().set('lead')
    expect(light).toHaveBeenLastCalledWith('lead')
    useTeamSceneHover.getState().set(null)
    expect(light).toHaveBeenLastCalledWith(null)
    stop()
    useTeamSceneHover.getState().set('a')
    expect(light).toHaveBeenLastCalledWith(null)
  })

  it('opens a clicked figure as its row does, but not at the end of a drag', () => {
    const el = canvas()
    const open = vi.fn()
    const stop = linkScene3dHover({ el, pick: () => 'a', light: () => {}, open, hold: hold() })
    fire(el, 'pointerdown', 60, 50)
    fire(el, 'click', 61, 50)
    expect(open).toHaveBeenCalledWith('a')
    open.mockClear()
    fire(el, 'pointerdown', 60, 50)
    fire(el, 'click', 120, 70)
    expect(open).not.toHaveBeenCalled()
    stop()
  })

  // Why: each stage rebuild relinks the canvas; the hover it lit must not outlive the pointer.
  it('clears a lit row when the pointer leaves, even after a rebuild relinked the canvas', () => {
    const el = canvas()
    const h = hold()
    const pick = vi.fn((p: { x: number; y: number }) => (p.x < 100 ? 'a' : null))
    const first = linkScene3dHover({ el, pick, light: () => {}, open: () => {}, hold: h })
    fire(el, 'pointermove', 60, 50)
    expect(useTeamSceneHover.getState().key).toBe('a')
    first()
    const second = linkScene3dHover({ el, pick, light: () => {}, open: () => {}, hold: h })
    fire(el, 'pointermove', 180, 50)
    expect(useTeamSceneHover.getState().key).toBeNull()
    second()
  })

  // Why: a camera drag owns the pointer, so the rows it passes over must not flicker.
  it('does not pick while a button is held down', () => {
    const el = canvas()
    const pick = vi.fn(() => 'a')
    const stop = linkScene3dHover({ el, pick, light: () => {}, open: () => {}, hold: hold() })
    el.dispatchEvent(
      Object.assign(new Event('pointermove'), {
        clientX: 60,
        clientY: 50,
        pointerType: 'mouse',
        buttons: 1
      })
    )
    expect(pick).not.toHaveBeenCalled()
    expect(useTeamSceneHover.getState().key).toBeNull()
    stop()
  })
})
