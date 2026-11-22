import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  DIORAMA_GATE,
  teamDioramaLayoutOf
} from '../../../../shared/team-scene/team-diorama-layout'
import type {
  TeamSceneActivity,
  TeamSceneInput
} from '../../../../shared/team-scene/team-scene-types'
import { DAY, dioramaKit } from './team-diorama-kit'
import { dioramaLeadActor } from './team-diorama-lead-actor'
import { dioramaCuesAfter, dioramaMoments } from './team-diorama-read'

const layout = teamDioramaLayoutOf([
  { key: '', name: '', home: true, reachable: true, members: ['a', 'b'], cap: null, taken: 0 },
  { key: 'm2', name: 'm2', home: false, reachable: true, members: ['x'], cap: 2, taken: 0 }
])
const team = (asking: string | null): TeamSceneInput => ({
  lead: { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' },
  advisor: null,
  members: ['a', 'b', 'x'].map((key) => ({
    key,
    name: key,
    characterKey: null,
    activity: (key === asking ? 'needsYou' : 'working') as TeamSceneActivity,
    reportId: null,
    mergedPr: null,
    site: { stage: 2, broken: false }
  }))
})
const kit = () =>
  dioramaKit(DAY, { attention: '#e40014', done: '#15803d', working: '#0369a1', risk: '#b45309' })
const leadAt = (input: TeamSceneInput, reads: number[]) => {
  const moments = dioramaMoments()
  let cues = dioramaCuesAfter(moments, input, layout, reads[0]!, false)
  for (const at of reads.slice(1)) {
    cues = dioramaCuesAfter(moments, input, layout, at, false)
  }
  return dioramaLeadActor(kit(), new THREE.Group(), {
    layout,
    input,
    cues,
    lite: true,
    pace: 'normal'
  })
}
const fromGate = (p: THREE.Vector3) => Math.hypot(p.x - DIORAMA_GATE[0], p.z - DIORAMA_GATE[1])

// ORCA-1336: the lead leaves the castle only for a real event, as in the 3D Office.
describe('the diorama lead', () => {
  it('stays at the castle while everyone works and nobody asks', () => {
    const lead = leadAt(team(null), [0, 5, 30])
    for (let t = 0; t < 120; t += 0.25) {
      lead.tick(t)
      expect(fromGate(lead.figure.g.position)).toBeLessThan(0.5)
    }
  })

  it('walks to the member who asks and is still beside it long after', () => {
    const lead = leadAt(team('x'), [0, 5])
    lead.tick(0)
    expect(fromGate(lead.figure.g.position)).toBeLessThan(0.5)
    lead.tick(2)
    expect(fromGate(lead.figure.g.position)).toBeGreaterThan(0.5)
    lead.tick(300)
    const at = lead.figure.g.position.clone()
    lead.tick(900)
    expect(lead.figure.g.position.distanceTo(at)).toBeLessThan(1e-6)
    expect(fromGate(at)).toBeGreaterThan(3)
  })
})
