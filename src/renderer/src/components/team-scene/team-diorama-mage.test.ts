import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { DioramaLeadRound } from '../../../../shared/team-scene/team-diorama-lead-round'
import { DAY, dioramaKit } from './team-diorama-kit'
import { dioramaMage } from './team-diorama-mage'

const kit = () =>
  dioramaKit(DAY, { attention: '#e40014', done: '#15803d', working: '#0369a1', risk: '#b45309' })
const round: DioramaLeadRound = {
  steps: [
    { kind: 'hold', at: [0, 0], face: null, pose: 'idle', start: 0, dur: 2 },
    { kind: 'jump', from: [0, 0], to: [6, 4], start: 2, dur: 1.6 }
  ],
  total: 3.6
}
const circlesShown = (world: THREE.Group) =>
  world.children.filter((o) => o.type === 'Group' && o.visible && o.children.length === 3)

describe('the court mage', () => {
  it('sends the lead by magic: the departure circle glows first, then the arrival one', () => {
    const world = new THREE.Group()
    const tick = dioramaMage(kit(), world, round, true)
    tick(1)
    expect(circlesShown(world)).toHaveLength(0)
    tick(2 + 1.6 * 0.3)
    const [first] = circlesShown(world)
    expect(first!.position.x).toBeCloseTo(0, 5)
    tick(2 + 1.6 * 0.7)
    const [second] = circlesShown(world)
    expect(second!.position.x).toBeCloseTo(6, 5)
  })
})
