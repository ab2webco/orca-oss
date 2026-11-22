import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { dioramaPlotViewOf } from '../../../../shared/team-scene/team-diorama-actions'
import { dioramaCuesOf } from '../../../../shared/team-scene/team-diorama-cues'
import {
  DIORAMA_GATE,
  teamDioramaLayoutOf
} from '../../../../shared/team-scene/team-diorama-layout'
import { teamSceneMemberLookOf } from '../../../../shared/team-scene/team-scene-member-looks'
import type {
  TeamSceneInput,
  TeamSceneMemberInput
} from '../../../../shared/team-scene/team-scene-types'
import { dioramaCast } from './team-diorama-cast'
import { DAY, dioramaKit } from './team-diorama-kit'

const kit = () =>
  dioramaKit(DAY, { attention: '#e40014', done: '#15803d', working: '#0369a1', risk: '#b45309' })
const member = (key: string, characterKey: string | null = null): TeamSceneMemberInput => ({
  key,
  name: key,
  characterKey,
  activity: 'working',
  reportId: null,
  mergedPr: null,
  site: { stage: 1, broken: false }
})
const castOf = (joinedAt: number | null, characterKey: string | null = null) => {
  const input = {
    lead: { key: 'lead', name: 'lead' },
    advisor: null,
    members: [member('a', characterKey)]
  } as unknown as TeamSceneInput
  const layout = teamDioramaLayoutOf([
    {
      key: '',
      name: 'm1',
      home: true,
      reachable: true,
      members: ['a'],
      cap: null,
      taken: 0
    }
  ])
  const views = new Map([['a', dioramaPlotViewOf(member('a'))]])
  const cues = joinedAt === null ? [] : dioramaCuesOf([{ kind: 'join', key: 'a' }], joinedAt)
  return dioramaCast(kit(), new THREE.Group(), {
    layout,
    views,
    input,
    cues,
    lite: true,
    stands: new Map()
  })
}
const play = (cast: ReturnType<typeof castOf>, t: number) => cast.ticks.forEach((tick) => tick(t))

describe('the diorama cast', () => {
  it('stands a working member at its plot from the first frame', () => {
    const cast = castOf(null)
    play(cast, 5)
    expect(cast.figures.get('a')!.g.visible).toBe(true)
  })

  it('has a member that just joined appear at the gate and walk to its plot', () => {
    const cast = castOf(10)
    const f = cast.figures.get('a')!
    const rest = f.g.position.clone()
    play(cast, 10.1)
    expect(f.g.visible).toBe(false)
    play(cast, 10.6)
    expect(f.g.visible).toBe(true)
    expect(
      Math.hypot(f.g.position.x - DIORAMA_GATE[0], f.g.position.z - DIORAMA_GATE[1])
    ).toBeLessThan(0.6)
    let last = f.g.position.clone()
    for (let t = 10.6; t < 18; t += 1 / 30) {
      play(cast, t)
      // Smooth: never more than a step's worth between frames.
      expect(f.g.position.distanceTo(last)).toBeLessThan(0.3)
      last = f.g.position.clone()
    }
    expect(f.g.position.distanceTo(rest)).toBeLessThan(0.01)
  })

  it('dresses a member as its Team list face, by its persistent character', () => {
    const tunicOf = (cast: ReturnType<typeof castOf>) =>
      (cast.figures.get('a')!.body.material as THREE.MeshBasicMaterial).color.getHex()
    for (const characterKey of ['char-ada', 'char-bo', 'char-cy', null]) {
      const want = teamSceneMemberLookOf({ role: 'member', key: 'a', characterKey }).tunic
      expect(tunicOf(castOf(null, characterKey))).toBe(want)
    }
  })
})
