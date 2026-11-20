import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { DIORAMA_UNIT_SCALE } from './team-diorama-figures'
import { OFFICE3D_LEAD_COAT, office3dDev, office3dLookOf } from './team-office3d-dev'
import { poseOffice3dSeated } from './team-office3d-seated-poses'

const colours = (g: THREE.Object3D): Set<number> => {
  const found = new Set<number>()
  g.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshToonMaterial | undefined
    if (m && m.side !== THREE.BackSide && m.color) {
      found.add(m.color.getHex())
    }
  })
  return found
}
const inkOutlines = (g: THREE.Object3D) => {
  let n = 0
  g.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined
    n += m?.side === THREE.BackSide ? 1 : 0
  })
  return n
}

describe('the 3D Office developers', () => {
  it('keeps a look per look number, so a member never changes clothes between reads', () => {
    expect(office3dLookOf(5, 'dev')).toEqual(office3dLookOf(5, 'dev'))
    const sweaters = new Set(Array.from({ length: 12 }, (_, i) => office3dLookOf(i, 'dev').sweater))
    expect(sweaters.size).toBe(12)
  })

  it('draws each developer toon-shaded with the ink outline, at the diorama scale', () => {
    const dev = office3dDev(3, 'dev')
    expect(inkOutlines(dev.g)).toBeGreaterThan(10)
    expect(dev.g.scale.x).toBe(DIORAMA_UNIT_SCALE)
    expect(colours(dev.g)).toContain(office3dLookOf(3, 'dev').sweater)
  })

  it('sets the lead apart: its violet coat, a headset, and a little larger than the team', () => {
    const lead = office3dDev(0, 'lead')
    expect(colours(lead.g)).toContain(OFFICE3D_LEAD_COAT)
    expect(lead.g.scale.x).toBeCloseTo(DIORAMA_UNIT_SCALE * 1.12)
    for (let i = 0; i < 12; i++) {
      expect(colours(office3dDev(i, 'dev').g)).not.toContain(OFFICE3D_LEAD_COAT)
    }
  })

  it('gives the lead and Jev a headset, and nobody else', () => {
    const torusCount = (g: THREE.Object3D) => {
      let n = 0
      g.traverse((o) => {
        const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
        n +=
          geo?.type === 'TorusGeometry' && (geo as THREE.TorusGeometry).parameters.radius > 0.3
            ? 1
            : 0
      })
      return n
    }
    expect(torusCount(office3dDev(0, 'lead').g)).toBeGreaterThan(0)
    expect(torusCount(office3dDev(1, 'advisor').g)).toBeGreaterThan(0)
    expect(torusCount(office3dDev(2, 'dev').g)).toBe(0)
  })

  it('hands the steward a tablet', () => {
    expect(office3dDev(4, 'steward').tool).not.toBeNull()
    expect(office3dDev(4, 'dev').tool).toBeNull()
  })
})

describe('seated poses', () => {
  const armsAt = (pose: Parameters<typeof poseOffice3dSeated>[1], t: number) => {
    const f = office3dDev(2, 'dev')
    poseOffice3dSeated(f, pose, t)
    return { left: f.arms[0]!.rotation.clone(), right: f.arms[1]!.rotation.clone(), f }
  }

  it('types with low, near-still forearms, so it never reads as steering a wheel', () => {
    for (let t = 0; t < 2; t += 0.05) {
      const { left, right } = armsAt('type', t)
      for (const arm of [left, right]) {
        expect(arm.x).toBeGreaterThanOrEqual(-1)
        expect(arm.x).toBeLessThanOrEqual(-0.96)
        expect(Math.abs(arm.z)).toBeLessThan(0.1)
      }
    }
  })

  it('raises a hand over the monitor when it needs you, and slumps at its limit', () => {
    expect(armsAt('raise', 0).left.z).toBeLessThan(-2.3)
    const slumped = armsAt('slump', 0).f
    expect(slumped.head.rotation.x).toBeGreaterThan(0.5)
    expect(slumped.body.rotation.x).toBeGreaterThan(0.2)
  })

  it('resets between poses, so a slump never carries into typing', () => {
    const f = office3dDev(2, 'dev')
    poseOffice3dSeated(f, 'slump', 0)
    poseOffice3dSeated(f, 'type', 0)
    expect(f.body.rotation.x).toBeCloseTo(0.06)
    expect(f.head.rotation.z).toBe(0)
  })
})
