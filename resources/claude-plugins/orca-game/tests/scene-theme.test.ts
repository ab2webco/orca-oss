// Runs under `claude plugin test`: the band draws the configured scene in its theme of the day.
import { describe, expect, test } from 'claude-code/testing'

import { currentScene, quest } from '../hooks/quest-state'
import { setContributedScenes, type SceneDefinition } from '../hooks/scenes/index'
import { QUEST_SCENE } from '../hooks/scenes/quest'

const THEMED: SceneDefinition = {
  ...QUEST_SCENE,
  id: 'game/themed',
  themes: [{ name: 'Frost', weight: 1, look: { ground: 0xffffff } }]
}

const groundsAt = (clocks: readonly number[]): number[] => {
  setContributedScenes([THEMED])
  quest.liveConfig = { scene: 'game/themed', timezone: 'UTC' }
  try {
    return clocks.map((clockMs) => {
      quest.clockMs = clockMs
      return currentScene().looks.working.ground
    })
  } finally {
    quest.liveConfig = {}
    quest.clockMs = 0
    setContributedScenes([])
  }
}

describe('the scene the band draws', () => {
  test('is the configured scene in its theme of the day, on the project’s timezone', () => {
    const grounds = groundsAt([Date.UTC(2026, 9, 21, 12), Date.UTC(2026, 9, 22, 12)])
    expect(new Set(grounds)).toEqual(new Set([QUEST_SCENE.looks.working.ground, 0xffffff]))
  })

  test('is the plain scene until the clock is first read', () => {
    expect(groundsAt([0])).toEqual([QUEST_SCENE.looks.working.ground])
  })
})
