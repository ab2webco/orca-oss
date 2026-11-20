import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  teamDioramaLayoutOf,
  type DioramaMachine
} from '../../../../shared/team-scene/team-diorama-layout'
import {
  dioramaPlotViewOf,
  type DioramaPlotView
} from '../../../../shared/team-scene/team-diorama-actions'
import type { TeamSceneMemberInput } from '../../../../shared/team-scene/team-scene-types'
import { DAY, NIGHT, dioramaKit } from './team-diorama-kit'
import { dioramaHouse } from './team-diorama-buildings'
import { dioramaCast } from './team-diorama-cast'
import { dioramaPlot } from './team-diorama-plots'
import { dioramaWorld } from './team-diorama-world-meshes'

const STATUS = { attention: '#e40014', done: '#15803d', working: '#0369a1', risk: '#b45309' }
const view = (over: Partial<DioramaPlotView> = {}): DioramaPlotView => ({
  action: 'build',
  stage: 1,
  fire: false,
  scaffold: null,
  flag: null,
  play: null,
  ...over
})
const idle = (key: string): TeamSceneMemberInput => ({
  key,
  name: key,
  characterKey: null,
  activity: 'resting',
  reportId: null,
  mergedPr: null,
  site: { stage: 0, broken: false }
})
const machine = (key: string, over: Partial<DioramaMachine> = {}): DioramaMachine => ({
  key,
  name: key,
  home: false,
  reachable: true,
  members: [],
  cap: 2,
  taken: 0,
  ...over
})
const kindsOf = (g: THREE.Object3D) => {
  const out: string[] = []
  g.traverse((o) => {
    if ((o as THREE.Mesh).geometry) {
      out.push((o as THREE.Mesh).geometry.type)
    }
  })
  return out
}

describe('the diorama world meshes', () => {
  it('builds each stage of a member build, a roof only once it is finished', () => {
    const k = dioramaKit(DAY, STATUS)
    const root = new THREE.Group()
    expect(kindsOf(dioramaHouse(k, 0, 0, 1, root))).not.toContain('ConeGeometry')
    expect(kindsOf(dioramaHouse(k, 0, 0, 3, root))).not.toContain('ConeGeometry')
    expect(kindsOf(dioramaHouse(k, 0, 0, 4, root))).toContain('ConeGeometry')
  })

  it('lights a CI scaffold in the working status colour, and flags a merge in the done one', () => {
    const k = dioramaKit(DAY, STATUS)
    const colors = (g: THREE.Object3D) => {
      const out: string[] = []
      g.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
        if (m?.color) {
          out.push(`#${m.color.getHexString()}`)
        }
      })
      return out
    }
    const plotted = (v: DioramaPlotView) => {
      const g = new THREE.Group()
      dioramaPlot(k, { x: 0, z: 0, key: 'a', taken: false }, v, g, true, [])
      return colors(g)
    }
    expect(plotted(view({ action: 'inspect', stage: 3, scaffold: 'lit' }))).toContain(
      STATUS.working
    )
    expect(plotted(view({ action: 'cheer', stage: 4, flag: 'merged' }))).toContain(STATUS.done)
  })

  it('never lays two ground surfaces of different colours at one height, so none flickers', () => {
    // A free member fishes off its own dock, so the fisher's planks are checked too.
    const layout = teamDioramaLayoutOf([
      machine('', { home: true, members: ['a', 'f', 'g'], cap: null }),
      machine('m2', { members: ['x'] })
    ])
    const views = new Map([
      ['a', view()],
      ['f', dioramaPlotViewOf(idle('f'), 0)],
      ['g', dioramaPlotViewOf(idle('g'), 1)],
      ['x', view({ stage: 4 })]
    ])
    for (const [palette, lite] of [
      [DAY, false],
      [NIGHT, true]
    ] as const) {
      const k = dioramaKit(palette, STATUS)
      const built = dioramaWorld(k, layout, views)
      const input = { lead: idle('lead'), advisor: null, members: [idle('f'), idle('g')] }
      dioramaCast(k, built.world, { layout, views, input, cues: [], lite, stands: built.stands })
      built.world.updateMatrixWorld(true)
      // Every flat face at ground level: grass tops, roads, plots, the field and every plank.
      const faces: { box: THREE.Box3; color: string; name: string }[] = []
      built.world.traverse((o) => {
        const m = o as THREE.Mesh
        // Scene surfaces only: a figure's ink outline is a back-face hull, not a ground face.
        const mat = m.material as THREE.Material | undefined
        if (m.geometry?.type !== 'BoxGeometry' || mat?.type !== 'MeshStandardMaterial') {
          return
        }
        const box = new THREE.Box3().setFromObject(m)
        if (box.max.y > -0.001 && box.max.y < 0.2) {
          const color = (m.material as THREE.MeshStandardMaterial).color?.getHexString() ?? ''
          faces.push({ box, color, name: m.parent?.userData.dock ? 'dock plank' : color })
        }
      })
      const clashes: string[] = []
      for (let i = 0; i < faces.length; i++) {
        for (let j = i + 1; j < faces.length; j++) {
          const [a, b] = [faces[i]!, faces[j]!]
          const overlapX = Math.min(a.box.max.x, b.box.max.x) - Math.max(a.box.min.x, b.box.min.x)
          const overlapZ = Math.min(a.box.max.z, b.box.max.z) - Math.max(a.box.min.z, b.box.min.z)
          const gap = Math.abs(a.box.max.y - b.box.max.y)
          if (a.color !== b.color && overlapX > 0.01 && overlapZ > 0.01 && gap < 0.015) {
            clashes.push(
              `${a.name} ${a.box.max.y.toFixed(3)} / ${b.name} ${b.box.max.y.toFixed(3)}`
            )
          }
        }
      }
      expect([...new Set(clashes)]).toEqual([])
      k.dispose(built.world)
    }
  })

  it('greys an island whose machine does not answer', () => {
    const k = dioramaKit(DAY, STATUS)
    const layout = teamDioramaLayoutOf([
      machine('', { home: true }),
      machine('off', { reachable: false })
    ])
    const { world } = dioramaWorld(k, layout, new Map())
    const grass = new Set<string>()
    world.traverse((o) => {
      const m = o as THREE.Mesh
      if (
        m.geometry?.type === 'BoxGeometry' &&
        (m.geometry as THREE.BoxGeometry).parameters.height === 0.22
      ) {
        grass.add((m.material as THREE.MeshStandardMaterial).color.getHexString())
      }
    })
    expect(grass.size).toBe(2)
  })
})
