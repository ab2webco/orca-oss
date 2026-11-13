import { describe, expect, it } from 'vitest'
import type { TeamSceneActor } from '../../../../shared/team-scene/team-scene-types'
import type { TeamSceneFrame } from './team-scene-painter'
import { createSceneEffects, SCENE_DUST } from './team-scene-painter-marks'
import { recordingContext } from './team-scene-recording-context'

const advisor = { key: 'advisor', x: 0.74, depth: 0.15 } as TeamSceneActor
const frame = { width: 400, height: 176, t: 0, dt: 1 / 30 } as TeamSceneFrame
const sparksOf = (effects: Parameters<ReturnType<typeof createSceneEffects>['start']>[0]) => {
  const fx = createSceneEffects((depth, h) => h - 36 + depth * 22)
  fx.start(effects, [advisor], 176)
  const r = recordingContext()
  fx.draw(r.g, frame)
  return r.calls.filter((c) => c.name === 'fillRect')
}

describe('scene effects', () => {
  it('puffs where the advisor vanished, not where it already reappeared', () => {
    const left = sparksOf([
      { kind: 'burst', key: 'advisor', reason: 'puff', at: { x: 0.2, depth: 0.6 } }
    ])
    expect(left.length).toBeGreaterThan(0)
    for (const spark of left) {
      expect(Math.abs((spark.args[0] as number) - 0.2 * 400)).toBeLessThan(20)
    }
  })

  it('draws a puff as a small dust cloud, not a celebration', () => {
    const puff = sparksOf([{ kind: 'burst', key: 'advisor', reason: 'puff' }])
    expect(puff.map((c) => c.fillStyle)).toContain(SCENE_DUST)
    expect(puff.length).toBeLessThan(14)
  })
})
