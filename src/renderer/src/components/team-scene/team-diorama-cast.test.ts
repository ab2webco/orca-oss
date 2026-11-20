import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { dioramaPlotViewOf } from '../../../../shared/team-scene/team-diorama-actions'
import { teamDioramaLayoutOf } from '../../../../shared/team-scene/team-diorama-layout'
import type {
  TeamSceneInput,
  TeamSceneMemberInput
} from '../../../../shared/team-scene/team-scene-types'
import { dioramaCast } from './team-diorama-cast'
import { DAY, dioramaKit } from './team-diorama-kit'

const kit = () =>
  dioramaKit(DAY, { attention: '#e40014', done: '#15803d', working: '#0369a1', risk: '#b45309' })
const member = (key: string): TeamSceneMemberInput => ({
  key,
  name: key,
  characterKey: null,
  activity: 'working',
  reportId: null,
  mergedPr: null,
  site: { stage: 1, broken: false }
})
const castOf = () => {
  const input = {
    lead: { key: 'lead', name: 'lead' },
    advisor: null,
    members: [member('a')]
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
  return dioramaCast(kit(), new THREE.Group(), { layout, views, input, lite: true })
}
const play = (cast: ReturnType<typeof castOf>, t: number) => cast.ticks.forEach((tick) => tick(t))

describe('the diorama cast', () => {
  it('stands a working member at its plot from the first frame', () => {
    const cast = castOf()
    play(cast, 5)
    expect(cast.figures.get('a')!.g.visible).toBe(true)
  })
})
