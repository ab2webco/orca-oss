import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  teamDioramaLayoutOf,
  type DioramaMachine
} from '../../../../shared/team-scene/team-diorama-layout'
import type { DioramaPlotView } from '../../../../shared/team-scene/team-diorama-actions'
import { DAY, NIGHT, dioramaKit } from './team-diorama-kit'
import { dioramaHouse } from './team-diorama-buildings'
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

  it('gives roads and plots their own heights, and lays dock planks as the approved file does', () => {
    const k = dioramaKit(NIGHT, STATUS)
    const layout = teamDioramaLayoutOf([
      machine('', { home: true, members: ['a'], cap: null }),
      machine('m2', { members: ['x'] })
    ])
    const { world } = dioramaWorld(
      k,
      layout,
      new Map([
        ['a', view()],
        ['x', view({ stage: 4 })]
      ])
    )
    const tops = new Set<string>()
    const planks = new Set<string>()
    world.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.geometry?.type !== 'BoxGeometry') {
        return
      }
      const { height, width, depth } = (mesh.geometry as THREE.BoxGeometry).parameters
      const top = +(mesh.getWorldPosition(new THREE.Vector3()).y + height / 2).toFixed(3)
      if (mesh.parent?.userData.dock && height < 0.1) {
        planks.add(String(top))
      } else if (height <= 0.1 && width >= 0.7 && depth >= 0.7 && top > 0 && top < 0.5) {
        tops.add(String(top))
      }
    })
    // Roads and plots each have their own height above the grass top at 0.
    expect([...tops].sort()).toEqual(['0.03', '0.04'])
    // The approved prototype lays every dock plank at y -0.04, its top level with the grass.
    expect([...planks]).toEqual(['0'])
    k.dispose(world)
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
