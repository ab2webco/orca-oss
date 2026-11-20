import type * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { Office3dFloor } from '../../../../shared/team-scene/team-office3d-layout'
import { DAY, dioramaKit } from './team-diorama-kit'
import { OFFICE3D_DAY, office3dFloor } from './team-office3d-floor'
import { paintOffice3dScreen } from './team-office3d-screens'

const calls = vi.hoisted(() => [] as string[])
vi.mock('./team-scene-desk-screens', () => ({ drawDeskScreen: () => calls.push('desk') }))
vi.mock('./team-scene-office-hold', () => ({ drawOfficeHoldScreen: () => calls.push('hold') }))
vi.mock('./team-scene-office-virus', () => ({ drawOfficeVirus: () => calls.push('virus') }))

const status = { attention: '#e40014', done: '#15803d', working: '#0369a1', risk: '#b45309' }
const floor = (over: Partial<Office3dFloor> = {}): Office3dFloor => ({
  key: '',
  name: '',
  lead: true,
  reachable: true,
  y: 0,
  width: 12,
  scale: 1,
  seats: [
    { key: 'a', kind: 'member', x: 1 },
    { key: null, kind: 'taken', x: 3 },
    { key: null, kind: 'free', x: 5 }
  ],
  used: 2,
  office: null,
  controlRoom: null,
  ...over
})
const colourCount = (g: THREE.Object3D, hex: number) => {
  let n = 0
  g.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    n += m?.color?.getHex() === hex ? 1 : 0
  })
  return n
}
const fake = () =>
  ({ fillStyle: '', fillRect: () => calls.push('fill') }) as unknown as CanvasRenderingContext2D

describe('a 3D Office floor', () => {
  it('draws one desk per seat and a coat only on the chair of another session', () => {
    const built = office3dFloor(dioramaKit(DAY, status), floor(), false, false)
    expect(built.desks).toHaveLength(3)
    expect(built.doors).toHaveLength(2)
    expect(colourCount(built.desks[0]!.group, OFFICE3D_DAY.coat)).toBe(0)
    expect(colourCount(built.desks[1]!.group, OFFICE3D_DAY.coat)).toBe(1)
    expect(colourCount(built.desks[2]!.group, OFFICE3D_DAY.coat)).toBe(0)
  })

  it('stands at its own height and hazes over only when its machine cannot be reached', () => {
    const puffs = (g: THREE.Object3D) => {
      let n = 0
      g.traverse((o) => {
        n += (o as THREE.Mesh).geometry?.type === 'IcosahedronGeometry' ? 1 : 0
      })
      return n
    }
    const kit = dioramaKit(DAY, status)
    expect(office3dFloor(kit, floor({ y: 9 }), false, false).group.position.y).toBe(9)
    expect(puffs(office3dFloor(kit, floor(), false, false).group)).toBe(0)
    expect(puffs(office3dFloor(kit, floor({ reachable: false }), false, false).group)).toBe(9)
  })
})

describe('a desk monitor', () => {
  it.each([
    [{ kind: 'desk' as const, desk: { kind: 'tests' as const } }, false, ['desk']],
    [{ kind: 'hold' as const, hold: 'limited' as const }, false, ['hold']],
    [{ kind: 'code' as const }, true, ['virus']],
    [{ kind: 'off' as const }, false, []]
  ])("paints %o with the 2D Office's own drawing", (screen, virus, expected) => {
    calls.length = 0
    paintOffice3dScreen(fake(), 112, 72, screen, virus, 0, status)
    expect(calls[0]).toBe('fill')
    expect(calls.filter((c) => c !== 'fill')).toEqual(expected)
  })
})
