import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import es from './locales/es.json'

function lookup(catalog: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      catalog
    )
}

// ORCA-1328 (L5): Settings > Agents and its capability sections read English in es.
// Why not 'Computer Use': es keeps it as the product name across its pane.
const KEYS = [
  'auto.components.settings.AgentCacheTimerSection.a137f8854d',
  'resumeVault.section.title',
  'resumeVault.section.description',
  'resumeVault.section.manage',
  'resumeVault.section.manageWithCount',
  'auto.components.settings.Settings.accountSwitchTitle',
  'auto.components.settings.Settings.accountSwitchDescription',
  'auto.hooks.useSettingsNavigationMetadata.accountSwitchTitle',
  'auto.hooks.useSettingsNavigationMetadata.accountSwitchDescription'
]

describe('Settings > Agents es copy', () => {
  it.each(KEYS)('%s is translated', (key) => {
    const english = lookup(en, key)
    const spanish = lookup(es, key)
    expect(typeof english).toBe('string')
    expect(typeof spanish).toBe('string')
    expect(spanish).not.toBe(english)
  })

  it("says 'agentes' in the permissions labels, not the English word", () => {
    expect(es.auto.components.settings.AgentsPane.agentPermissions).toBe('Permisos de los agentes')
    expect(es.auto.components.settings.AgentsPane.agentPermissionsInfo).not.toMatch(/Agents/)
  })

  it("says 'agentes' in the rest of the Agents pane's own lines", () => {
    const pane = es.auto.components.settings.AgentsPane
    for (const line of [
      pane.agentPermissionsTooltip,
      pane.agentPermissionsDescription,
      pane.d83834f5e6,
      pane['024bd95089']
    ]) {
      expect(line).not.toMatch(/\bagents\b/i)
    }
  })

  it('keeps placeholders the English source has', () => {
    expect(lookup(es, 'resumeVault.section.manageWithCount')).toContain('{{value0}}')
  })
})
