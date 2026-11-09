import { describe, expect, it } from 'vitest'
import { orchestratorGameSceneArtFiles } from '../../../../shared/orchestrator-game-scene-native'
import { teamSceneQuestArtOf, teamSceneQuestArtUrl } from './team-scene-quest-art'

describe('teamSceneQuestArtOf', () => {
  it.each(['figures', 'office'] as const)('resolves every %s image to a bundled url', (style) => {
    const art = teamSceneQuestArtOf(style)
    const files = orchestratorGameSceneArtFiles({ [style]: art })
    expect(files.length).toBeGreaterThan(10)
    for (const src of files) {
      expect(teamSceneQuestArtUrl(src)).toEqual(expect.any(String))
    }
  })

  it('has no url for a file the art does not ship', () => {
    expect(teamSceneQuestArtUrl('figures/nope.png')).toBeUndefined()
  })

  it('walks at the stride the sheets were drawn with', () => {
    const { walk } = teamSceneQuestArtOf('figures').roles.lead.animations
    expect(walk?.stride).toBe(35)
  })
})
