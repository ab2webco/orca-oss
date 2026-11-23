import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { DIORAMA_UNIT_SCALE } from './team-diorama-figures'
import {
  OFFICE_ADVISOR_LOOK,
  OFFICE_LEAD_LOOK,
  OFFICE_MEMBER_LOOKS,
  teamSceneLookSeedOf
} from '../../../../shared/team-scene/team-scene-member-looks'
import { office3dDev, office3dLookOf } from './team-office3d-dev'
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
  it('dresses each developer as the Office sheet its Team list face wears, by the same index', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const seed = `char-${i}`
      const sheet = OFFICE_MEMBER_LOOKS[teamSceneLookSeedOf(seed) % OFFICE_MEMBER_LOOKS.length]!
      const look = office3dLookOf(seed, 'dev')
      expect(look).toEqual(office3dLookOf(seed, 'dev'))
      expect([look.sweater, look.hair, look.skin, look.pants, look.beard]).toEqual([
        sheet.sweater,
        sheet.hair,
        sheet.skin,
        sheet.pants,
        sheet.beard
      ])
      seen.add(sheet.sheet)
    }
    expect(seen.size).toBe(OFFICE_MEMBER_LOOKS.length)
  })

  it('draws each developer toon-shaded with the ink outline, at the diorama scale', () => {
    const dev = office3dDev('char-3', 'dev')
    expect(inkOutlines(dev.g)).toBeGreaterThan(10)
    expect(dev.g.scale.x).toBe(DIORAMA_UNIT_SCALE)
    expect(colours(dev.g)).toContain(office3dLookOf('char-3', 'dev').sweater)
  })

  it('dresses the lead as its Office sheet: navy, crowned, with a headset, a little larger', () => {
    const crowned = (g: THREE.Object3D) => g.getObjectByName('crown') !== undefined
    const lead = office3dDev('lead-char', 'lead')
    expect(colours(lead.g)).toContain(OFFICE_LEAD_LOOK.sweater)
    expect(colours(lead.g)).toContain(OFFICE_LEAD_LOOK.hair)
    expect(crowned(lead.g)).toBe(true)
    expect(lead.g.scale.x).toBeCloseTo(DIORAMA_UNIT_SCALE * 1.12)
    for (let i = 0; i < 12; i++) {
      expect(crowned(office3dDev(`char-${i}`, 'dev').g)).toBe(false)
    }
  })

  it('dresses Jev as the Office advisor sheet', () => {
    const jev = office3dDev('advisor:home', 'advisor')
    expect(colours(jev.g)).toContain(OFFICE_ADVISOR_LOOK.sweater)
    expect(colours(jev.g)).toContain(OFFICE_ADVISOR_LOOK.hair)
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
    expect(torusCount(office3dDev('char-0', 'lead').g)).toBeGreaterThan(0)
    expect(torusCount(office3dDev('char-1', 'advisor').g)).toBeGreaterThan(0)
    expect(torusCount(office3dDev('char-2', 'dev').g)).toBe(0)
  })

  it('hands the steward a tablet', () => {
    expect(office3dDev('char-4', 'steward').tool).not.toBeNull()
    expect(office3dDev('char-4', 'dev').tool).toBeNull()
  })
})

describe('seated poses', () => {
  const armsAt = (pose: Parameters<typeof poseOffice3dSeated>[1], t: number) => {
    const f = office3dDev('char-2', 'dev')
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
    const f = office3dDev('char-2', 'dev')
    poseOffice3dSeated(f, 'slump', 0)
    poseOffice3dSeated(f, 'type', 0)
    expect(f.body.rotation.x).toBeCloseTo(0.06)
    expect(f.head.rotation.z).toBe(0)
  })
})
