import type * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  OFFICE3D_BALCONY_Y,
  type Office3dFloor
} from '../../../../shared/team-scene/team-office3d-layout'
import { DAY, dioramaKit } from './team-diorama-kit'
import { OFFICE3D_DAY } from './team-office3d-floor'
import { OFFICE3D_LABEL_MIN_PX, office3dLabelOf, office3dLabelScale } from './team-office3d-labels'
import { office3dControlRoom, office3dLeadOffice } from './team-office3d-wing'

const status = { attention: '#e40014', done: '#15803d', working: '#0369a1', risk: '#b45309' }
const kit = () => dioramaKit(DAY, status)
const floor = (over: Partial<Office3dFloor> = {}): Office3dFloor => ({
  key: '',
  name: '',
  lead: true,
  reachable: true,
  y: 0,
  width: 12,
  scale: 1,
  seats: Array.from({ length: 5 }, (_, i) => ({ key: null, kind: 'free' as const, x: i })),
  used: 3,
  office: { x: 12, desk: [14, 1.65] },
  controlRoom: null,
  ...over
})
const meshCount = (g: THREE.Object3D) => {
  let n = 0
  g.traverse((o) => {
    n += (o as THREE.Mesh).isMesh ? 1 : 0
  })
  return n
}

describe("the lead's office and Jev's control room", () => {
  it('draws no control room on a floor whose Jev has not spoken', () => {
    expect(office3dControlRoom(kit(), OFFICE3D_DAY, floor(), false)).toBeNull()
  })

  it("puts the lead floor's room on a balcony with the stair, and others' at floor level", () => {
    const balcony = office3dControlRoom(
      kit(),
      OFFICE3D_DAY,
      floor({ controlRoom: { x: 12, y: OFFICE3D_BALCONY_Y, balcony: true, chair: [13.6, 2] } }),
      false
    )!
    const ground = office3dControlRoom(
      kit(),
      OFFICE3D_DAY,
      floor({
        lead: false,
        y: 9,
        office: null,
        controlRoom: { x: 12, y: 9, balcony: false, chair: [13.95, 2] }
      }),
      false
    )!
    expect(balcony.group.position.y).toBe(OFFICE3D_BALCONY_Y)
    expect(ground.group.position.y).toBe(9)
    // The balcony carries the 18 stair steps; the room at floor level has none.
    expect(meshCount(balcony.group) - meshCount(ground.group)).toBeGreaterThanOrEqual(16)
  })

  it("stands the lead's office beside the desks at the floor's height", () => {
    const office = office3dLeadOffice(kit(), OFFICE3D_DAY, floor({ y: 0, width: 13 }))
    expect([office.position.x, office.position.y]).toEqual([13, 0])
  })
})

describe('floor labels', () => {
  const words = { thisMachine: 'This machine', offline: 'offline' }

  it('names the machine and its desks used, and cuts a long name, never the count', () => {
    expect(office3dLabelOf(floor(), words)).toBe('This machine · 3/5')
    expect(office3dLabelOf(floor({ lead: false, name: 'build-server-eu-west-2' }), words)).toBe(
      'build-server-… · 3/5'
    )
    expect(office3dLabelOf(floor({ lead: false, name: 'gpu', reachable: false }), words)).toBe(
      'gpu · offline'
    )
  })

  it('never draws a chip under the minimum on-screen height, as in a 219 px panel', () => {
    // A narrow panel gives few px per world unit; at 14 the diorama's 0.62-unit chip is 9 px tall.
    const [, small] = office3dLabelScale(14, 4)
    expect(small * 14).toBeGreaterThanOrEqual(OFFICE3D_LABEL_MIN_PX)
    // Large views keep the diorama's chip size.
    expect(office3dLabelScale(120, 4)).toEqual([0.62 * 4, 0.62])
  })
})
