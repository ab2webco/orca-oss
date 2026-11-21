import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { OFFICE3D_LIFT, OFFICE3D_PITCH } from '../../../../shared/team-scene/team-office3d-layout'
import { office3dAcrossFloors, office3dPassOf } from './team-office3d-floor-passes'

const at = (x: number, y: number, z: number) => {
  const o = new THREE.Object3D()
  o.position.set(x, y, z)
  return o
}

describe('the pass each part of the 3D Office is drawn in', () => {
  it('is the floor it stands on, seated, walking or hung under its slab', () => {
    expect(office3dPassOf(at(4, OFFICE3D_PITCH, 4), 3)).toBe(1)
    expect(office3dPassOf(at(4, OFFICE3D_PITCH + 0.5, 4), 3)).toBe(1)
    expect(office3dPassOf(at(4, OFFICE3D_PITCH * 2 - 0.8, 4), 3)).toBe(2)
    expect(office3dPassOf(at(4, OFFICE3D_PITCH * 2 + 2.3, 4), 3)).toBe(2)
    expect(office3dPassOf(at(4, OFFICE3D_PITCH * 9, 4), 3)).toBe(2)
  })

  it("is the shaft's for the shaft and for a rider in the cab, even between two floors", () => {
    const shaft = at(0, 0, 0)
    office3dAcrossFloors(shaft)
    expect(office3dPassOf(shaft, 3)).toBe(3)
    expect(office3dPassOf(at(OFFICE3D_LIFT[0], OFFICE3D_PITCH * 1.5, OFFICE3D_LIFT[1]), 3)).toBe(3)
    // Waiting at the call panel beside the doors, it is still on its floor.
    expect(office3dPassOf(at(0.55, OFFICE3D_PITCH, 3.35), 3)).toBe(1)
  })
})
