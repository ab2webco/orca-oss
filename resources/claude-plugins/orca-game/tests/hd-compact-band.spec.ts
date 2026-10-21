import { describe, expect, it } from 'vitest'

import { heroCloudLeftOf } from '../hooks/hd-words'
import { HD_COMPACT_ROWS, HD_ROWS, hdSceneGridOf } from '../hooks/scene-hd'
import { sceneOf, SCENES } from '../hooks/scenes/index'

const speaker = { left: 20, top: 6, width: 12 }

describe('hd-compact band', () => {
  it('puts the thought cloud beside the hero when the band is too short for it above', () => {
    expect(heroCloudLeftOf(HD_COMPACT_ROWS, speaker)).toBeGreaterThanOrEqual(
      speaker.left + speaker.width
    )
    expect(heroCloudLeftOf(HD_ROWS, speaker)).toBe(speaker.left + speaker.width - 2)
  })

  it('draws every built-in scene in the short band at narrow and wide panes', () => {
    for (const scene of Object.keys(SCENES)) {
      for (const columns of [40, 60, 130]) {
        const grid = hdSceneGridOf({
          scene: sceneOf(scene),
          phase: 'build',
          columns,
          rows: HD_COMPACT_ROWS,
          tick: 41,
          caption: 'Editing scene.ts',
          since: 0
        })
        expect(grid).toHaveLength(columns * HD_COMPACT_ROWS)
      }
    }
  })
})
