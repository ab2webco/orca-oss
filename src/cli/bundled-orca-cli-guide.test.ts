import { describe, expect, it } from 'vitest'
import { BUNDLED_SKILL_GUIDES } from './bundled-skill-guides'

describe('bundled orca-cli guide', () => {
  const guide = BUNDLED_SKILL_GUIDES.find((entry) => entry.name === 'orca-cli')

  it('is served with the orca sonar section agents use for code lookup', () => {
    expect(guide).toBeDefined()
    expect(guide?.fullMarkdown).toContain('## Sonar Code Lookup')
    expect(guide?.fullMarkdown).toContain('orca sonar find')
    expect(guide?.fullMarkdown).toContain('orca sonar symbol')
  })
})
