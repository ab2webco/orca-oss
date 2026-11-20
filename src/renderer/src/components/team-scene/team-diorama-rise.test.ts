import type * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { dioramaIslandCuesOf } from '../../../../shared/team-scene/team-diorama-cues'
import { teamDioramaLayoutOf } from '../../../../shared/team-scene/team-diorama-layout'
import { DAY, dioramaKit } from './team-diorama-kit'
import { dioramaRises } from './team-diorama-rise'
import { dioramaWorld } from './team-diorama-world-meshes'

const kit = () =>
  dioramaKit(DAY, { attention: '#e40014', done: '#15803d', working: '#0369a1', risk: '#b45309' })
const machine = (key: string, home: boolean) => ({
  key,
  name: key,
  home,
  reachable: true,
  members: [],
  cap: home ? null : 2,
  taken: 0
})

describe('a newly connected machine in the diorama', () => {
  it('raises its island out of the sea, then builds its dock up from the water', () => {
    const layout = teamDioramaLayoutOf([machine('', true), machine('m2', false)])
    const { world } = dioramaWorld(kit(), layout, new Map())
    const cues = dioramaIslandCuesOf([''], layout.islands, 10)
    const [rise] = dioramaRises(world, cues)
    const island = world.children.find((o) => o.userData.island === 'm2')!
    const home = world.children.find((o) => o.userData.island === '')!
    const dock = island.children.find((o) => o.userData.dock) as THREE.Object3D
    rise!(10)
    expect(island.position.y).toBeLessThan(-3)
    expect(dock.visible).toBe(false)
    rise!(11.4)
    expect(island.position.y).toBeGreaterThan(-3)
    expect(island.position.y).toBeLessThan(0)
    rise!(13.3)
    expect(island.position.y).toBeCloseTo(0, 9)
    expect(dock.visible).toBe(true)
    rise!(20)
    expect(island.position.y).toBeCloseTo(0, 9)
    expect(dock.scale.y).toBe(1)
    expect(home.position.y).toBe(0)
  })

  it('carries the island roads with it, so no road floats over the water while it rises', () => {
    const layout = teamDioramaLayoutOf([machine('', true), machine('m2', false)])
    const { world } = dioramaWorld(kit(), layout, new Map())
    const island = world.children.find((o) => o.userData.island === 'm2')!
    const roads = island.children.filter(
      (o) => Math.abs(o.position.y - 0.015) < 1e-6 && (o as THREE.Mesh).isMesh
    )
    expect(roads.length).toBeGreaterThan(0)
  })
})
