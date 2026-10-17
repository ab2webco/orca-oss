import { describe, expect, it } from 'vitest'

import { getAgentsPaneSearchEntries } from './agents-search'
import { getOrcaGameScenesSkillSearchEntries } from './orca-game-scenes-skill-search'

describe('getOrcaGameScenesSkillSearchEntries', () => {
  it('indexes the scenes skill by its name and what people ask it for', () => {
    const [entry] = getOrcaGameScenesSkillSearchEntries()
    expect(entry?.title).toBe('Game scenes skill')
    expect(entry?.keywords).toEqual(
      expect.arrayContaining(['orca-game-scenes', 'scene', 'skill', 'theme', 'agent teams'])
    )
  })

  it('keeps the Agents pane in the sidebar when the search names the skill', () => {
    expect(getAgentsPaneSearchEntries().map((entry) => entry.title)).toContain('Game scenes skill')
  })
})
