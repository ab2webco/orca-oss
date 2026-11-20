import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type {
  DioramaAction,
  DioramaPlotView
} from '../../../../shared/team-scene/team-diorama-actions'
import { DAY, dioramaKit } from './team-diorama-kit'
import { dioramaPlot } from './team-diorama-plots'

const STATUS = { attention: '#e40014', done: '#15803d', working: '#0369a1', risk: '#b45309' }
const view = (action: DioramaAction, stage: DioramaPlotView['stage'] = 1): DioramaPlotView => ({
  action,
  stage,
  fire: false,
  scaffold: null,
  flag: null,
  play: null
})
const drawn = (v: DioramaPlotView | undefined, live = true) => {
  const g = new THREE.Group()
  const ticks: ((t: number) => void)[] = []
  const stand = dioramaPlot(
    dioramaKit(DAY, STATUS),
    { x: 0, z: 0, key: 'a', taken: false },
    v,
    g,
    live,
    ticks
  )
  ticks.forEach((tick) => tick(1))
  const tags = new Set<string>()
  g.traverse((o) => Object.keys(o.userData).forEach((key) => tags.add(key)))
  return { g, stand, tags, ticks }
}

describe('a member plot in the diorama', () => {
  it('shows what every live state does on its plot, as the approved prototype draws it', () => {
    expect(drawn(view('build')).tags).toContain('plot')
    expect(drawn(view('inspect')).tags).toContain('scaffold')
    expect(drawn(view('wait')).tags).toContain('flag')
    expect(drawn(view('signal')).tags).toContain('signal')
    expect(drawn(view('repair')).tags).toContain('fire')
    expect(drawn(view('cheer')).tags).toContain('flag')
    // A merge keeps raining confetti while its machine answers.
    expect(drawn(view('cheer')).ticks.length).toBe(2)
  })

  it('never leaves a live member an empty plot: a build stands at least at its frame', () => {
    for (const action of ['build', 'idle', 'rest', 'gone'] as const) {
      const { g } = drawn(view(action, 0))
      const roofTop = g.children.find((o) => o.userData.roofTop !== undefined)
      expect(roofTop, action).toBeDefined()
    }
  })

  it('stands the member where the prototype stands it, facing its work', () => {
    expect(drawn(view('build')).stand).toMatchObject({ dx: 1.55, dz: 1.2, pose: 'hammer' })
    expect(drawn(view('signal')).stand).toMatchObject({ pose: 'wave' })
    expect(drawn(view('cheer')).stand).toMatchObject({ pose: 'cheer' })
  })

  it('keeps an unreachable machine still: no lit scaffold and no confetti', () => {
    expect(drawn(view('inspect'), false).tags).not.toContain('scaffold')
    expect(drawn(view('cheer'), false).ticks.length).toBe(1)
  })

  it('marks a free plot with a sign, and a seat another session holds only dimly', () => {
    expect(drawn(undefined).stand).toBeNull()
    expect(drawn(undefined).g.children.length).toBe(3)
  })
})
