import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { DAY, dioramaKit } from './team-diorama-kit'
import { DIORAMA_UNIT_SCALE, dioramaFigure, dioramaLookOf } from './team-diorama-figures'
import { POSE_OF_ACTION, poseDioramaFigure } from './team-diorama-poses'

const kit = () =>
  dioramaKit(DAY, { attention: '#e40014', done: '#15803d', working: '#0369a1', risk: '#b45309' })
const inkOutlines = (g: THREE.Object3D) => {
  let n = 0
  g.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined
    if (m && m.side === THREE.BackSide) {
      n += 1
    }
  })
  return n
}

describe('the diorama figures', () => {
  it('outlines the illustrated figure in ink, and draws the low-resource one without outlines', () => {
    expect(inkOutlines(dioramaFigure(kit(), 3, { lite: false }).g)).toBeGreaterThan(8)
    expect(inkOutlines(dioramaFigure(kit(), 3, { lite: true }).g)).toBe(0)
  })

  it('draws each quality with its own prototype model, 1.6 times the prototype size', () => {
    const materials = (g: THREE.Object3D) => {
      const kinds = new Set<string>()
      g.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined
        if (m && m.side !== THREE.BackSide) {
          kinds.add(m.type)
        }
      })
      return kinds
    }
    const toon = dioramaFigure(kit(), 0, { lite: false })
    const lite = dioramaFigure(kit(), 0, { lite: true })
    expect(materials(toon.g)).toContain('MeshToonMaterial')
    expect(materials(lite.g)).toContain('MeshLambertMaterial')
    expect(materials(lite.g)).not.toContain('MeshToonMaterial')
    // The low-poly unit is the prototype's own: far fewer parts than the illustrated one.
    expect(lite.g.children.length).toBeLessThan(toon.g.children.length)
    expect(toon.g.scale.x).toBe(DIORAMA_UNIT_SCALE)
    expect(dioramaFigure(kit(), 0, { lead: true, lite: true }).g.scale.x).toBeCloseTo(
      DIORAMA_UNIT_SCALE * 1.12
    )
  })

  it('keeps a member look by its character, so it never changes between reads', () => {
    expect(dioramaLookOf('char-ada')).toBe(dioramaLookOf('char-ada'))
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(dioramaLookOf)).size).toBeGreaterThan(3)
  })

  it('flies the lead banner outside its head', () => {
    const lead = dioramaFigure(kit(), 0, { lead: true, lite: false })
    lead.g.updateMatrixWorld(true)
    const head = lead.head.getWorldPosition(new THREE.Vector3())
    let banner: THREE.Vector3 | null = null
    lead.g.traverse((o) => {
      if ((o as THREE.Mesh).geometry?.type === 'PlaneGeometry') {
        banner = o.getWorldPosition(new THREE.Vector3())
      }
    })
    expect(Math.abs(banner!.x - head.x)).toBeGreaterThan(0.3 * 1.12)
  })
})

describe('the diorama poses', () => {
  it('cheers and waves in place: no hop at any moment, as the owner asked', () => {
    const f = dioramaFigure(kit(), 1, { lite: true })
    for (const pose of ['cheer', 'wave', 'hammer', 'idle'] as const) {
      for (let t = 0; t < 4; t += 0.1) {
        poseDioramaFigure(f, pose, t)
        expect(f.g.position.y).toBe(0)
      }
    }
  })

  it('swings the hammer smoothly with time and seats a resting member', () => {
    const f = dioramaFigure(kit(), 1, { lite: true })
    poseDioramaFigure(f, 'hammer', 0)
    const a = f.arms[1]!.rotation.x
    poseDioramaFigure(f, 'hammer', 0.3)
    expect(f.arms[1]!.rotation.x).not.toBe(a)
    expect(Math.abs(f.arms[1]!.rotation.x - a)).toBeLessThan(1)
    poseDioramaFigure(f, 'sit', 0)
    expect(f.g.position.y).toBeLessThan(0)
  })

  it('gives every action a pose', () => {
    expect(POSE_OF_ACTION.signal).toBe('wave')
    expect(POSE_OF_ACTION.repair).toBe('hammer')
    expect(POSE_OF_ACTION.rest).toBe('sit')
  })
})
