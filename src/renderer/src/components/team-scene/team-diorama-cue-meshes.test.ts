import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { dioramaCuesOf } from '../../../../shared/team-scene/team-diorama-cues'
import { dioramaAdvisor, DIORAMA_TOWER } from './team-diorama-advisor'
import { dioramaCueEffects } from './team-diorama-cue-meshes'
import { DAY, dioramaKit } from './team-diorama-kit'

const kit = () =>
  dioramaKit(DAY, { attention: '#e40014', done: '#15803d', working: '#0369a1', risk: '#b45309' })
const shown = (root: THREE.Object3D) =>
  root.children.filter((o) => o.visible && (o as THREE.Mesh).isMesh !== undefined).length

describe('the diorama cue effects', () => {
  it('flies the advisor bird from its tower to the member and then lets it go', () => {
    const world = new THREE.Group()
    const member = new THREE.Vector3(6, 0, 4)
    const cues = dioramaCuesOf(
      [{ kind: 'judged', key: 'a', gesture: 'approved', tone: 'allow' }],
      10
    )
    const ticks = dioramaCueEffects(kit(), world, cues, () => member.clone(), DIORAMA_TOWER)
    expect(ticks).toHaveLength(1)
    const bird = world.children[0]!
    ticks[0]!(10.5)
    expect(bird.visible).toBe(false)
    ticks[0]!(11)
    expect(bird.position.distanceTo(DIORAMA_TOWER)).toBeLessThan(1)
    ticks[0]!(13.2)
    expect(Math.hypot(bird.position.x - member.x, bird.position.z - member.z)).toBeLessThan(0.1)
    ticks[0]!(14.5)
    expect(bird.visible).toBe(false)
  })

  it('shows a merge confetti only while it plays', () => {
    const world = new THREE.Group()
    const cues = dioramaCuesOf([{ kind: 'merge', key: 'a' }], 10)
    const [tick] = dioramaCueEffects(kit(), world, cues, () => new THREE.Vector3(), null)
    tick!(9)
    expect(shown(world)).toBe(0)
    tick!(11)
    expect(shown(world)).toBeGreaterThan(20)
    tick!(15)
    expect(shown(world)).toBe(0)
  })

  it('sends no bird without an advisor', () => {
    const cues = dioramaCuesOf(
      [{ kind: 'judged', key: 'a', gesture: 'approved', tone: 'allow' }],
      1
    )
    expect(
      dioramaCueEffects(kit(), new THREE.Group(), cues, () => new THREE.Vector3(), null)
    ).toEqual([])
  })
})

describe('the advisor on its tower', () => {
  it('scans with its spyglass, and lowers it to speak when it decides', () => {
    const cues = dioramaCuesOf([{ kind: 'advisorSpoke', line: 'ok' }], 10)
    const advisor = dioramaAdvisor(kit(), new THREE.Group(), cues, true, null)
    advisor.tick(5)
    const spying = advisor.figure.arms[1]!.rotation.x
    expect(spying).toBeLessThan(-1.8)
    advisor.tick(11)
    expect(advisor.figure.arms[1]!.rotation.x).toBeGreaterThan(-1.2)
    expect(advisor.figure.g.position.y).toBeCloseTo(DIORAMA_TOWER.y, 5)
  })
})
