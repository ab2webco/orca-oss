import { describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/i18n/localized-catalog', () => ({
  createLocalizedCatalog:
    <T>(loader: () => T) =>
    () =>
      loader()
}))

vi.mock('./settings-search-keywords', () => ({
  translateSearchKeyword: (_key: string, fallback: string) => [fallback]
}))

import { getAccountSwitchAgentSkillPaneSearchEntries } from './account-switch-agent-skill-search'

describe('getAccountSwitchAgentSkillPaneSearchEntries', () => {
  it('returns a single entry for the account-switch skill', () => {
    const entries = getAccountSwitchAgentSkillPaneSearchEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].title).toBe('Account switching')
    expect(entries[0].description.toLowerCase()).toContain('account')
  })

  it('indexes the terms a user reaches for, including the slash command', () => {
    // Why these: the pane is not tied to any provider connection, so search is
    // the only way to find it — "rate limit" is what sends people looking.
    expect(getAccountSwitchAgentSkillPaneSearchEntries()[0].keywords).toEqual(
      expect.arrayContaining([
        'account',
        'switch account',
        'switch-account',
        'claude account',
        'rate limit',
        'quota',
        'skill'
      ])
    )
  })
})
