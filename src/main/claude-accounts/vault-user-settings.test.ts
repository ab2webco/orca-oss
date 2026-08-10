import { describe, expect, it } from 'vitest'
import {
  INHERITABLE_VAULT_SETTING_KEYS,
  describeSettingInheritance,
  mergeUserSettingsIntoVaultSettings,
  selectInheritableSettings
} from './vault-user-settings'

const HOME_SETTINGS = {
  includeCoAuthoredBy: false,
  attribution: { commit: '', pr: '' },
  permissions: { defaultMode: 'acceptEdits', allow: ['Bash(npm test)'], deny: ['Bash(rm -rf /)'] },
  skillOverrides: { 'branch-pr': 'always' },
  agentPushNotifEnabled: true,
  outputStyle: 'Fried brain (shareable)',
  // Identity- or Orca-owned keys that must never cross into a vault.
  env: { ANTHROPIC_AUTH_TOKEN: 'secret' },
  statusLine: { type: 'command', command: 'orca-status' },
  hooks: { SessionStart: [] },
  mcpServers: { context7: {} },
  theme: 'dark'
}

describe('selectInheritableSettings', () => {
  it('takes the user-owned keys and leaves identity- and Orca-owned keys behind', () => {
    const selected = selectInheritableSettings(HOME_SETTINGS)
    expect(Object.keys(selected).sort()).toEqual([...INHERITABLE_VAULT_SETTING_KEYS].sort())
    for (const excluded of ['env', 'statusLine', 'hooks', 'mcpServers', 'theme']) {
      expect(selected).not.toHaveProperty(excluded)
    }
  })

  it('omits keys the home file does not define', () => {
    expect(selectInheritableSettings({ includeCoAuthoredBy: false })).toEqual({
      includeCoAuthoredBy: false
    })
  })
})

describe('mergeUserSettingsIntoVaultSettings', () => {
  const inheritable = selectInheritableSettings(HOME_SETTINGS)

  it('applies the attribution rule that a managed session was silently losing', () => {
    const merged = mergeUserSettingsIntoVaultSettings('{"theme":"dark"}', inheritable)
    const parsed = JSON.parse(merged ?? '{}')
    expect(parsed.includeCoAuthoredBy).toBe(false)
    expect(parsed.attribution).toEqual({ commit: '', pr: '' })
  })

  it('preserves the vault keys it does not own, including a custom-endpoint token', () => {
    const vault = JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'vault-token' }, theme: 'light' })
    const parsed = JSON.parse(mergeUserSettingsIntoVaultSettings(vault, inheritable) ?? '{}')
    expect(parsed.env).toEqual({ ANTHROPIC_AUTH_TOKEN: 'vault-token' })
    expect(parsed.theme).toBe('light')
  })

  it('unions permission lists so a vault-local deny is never dropped', () => {
    const vault = JSON.stringify({
      permissions: { defaultMode: 'plan', allow: ['Bash(ls)'], deny: ['Bash(curl:*)'] }
    })
    const parsed = JSON.parse(mergeUserSettingsIntoVaultSettings(vault, inheritable) ?? '{}')
    expect(parsed.permissions.deny).toEqual(['Bash(curl:*)', 'Bash(rm -rf /)'])
    expect(parsed.permissions.allow).toEqual(['Bash(ls)', 'Bash(npm test)'])
    // defaultMode is a scalar the user owns at home, so home wins.
    expect(parsed.permissions.defaultMode).toBe('acceptEdits')
  })

  it('keeps vault-only skill overrides and lets home win per skill', () => {
    const vault = JSON.stringify({ skillOverrides: { 'branch-pr': 'never', local: 'always' } })
    const parsed = JSON.parse(mergeUserSettingsIntoVaultSettings(vault, inheritable) ?? '{}')
    expect(parsed.skillOverrides).toEqual({ 'branch-pr': 'always', local: 'always' })
  })

  it('is idempotent: a second launch against its own output writes nothing', () => {
    const first = mergeUserSettingsIntoVaultSettings('{"theme":"dark"}', inheritable)
    expect(first).not.toBeNull()
    expect(mergeUserSettingsIntoVaultSettings(first, inheritable)).toBeNull()
  })

  it('seeds a vault whose settings.json is empty rather than refusing forever', () => {
    for (const empty of ['', '   \n']) {
      const parsed = JSON.parse(mergeUserSettingsIntoVaultSettings(empty, inheritable) ?? '{}')
      expect(parsed.includeCoAuthoredBy).toBe(false)
    }
  })

  it('never clobbers unparseable vault content', () => {
    expect(mergeUserSettingsIntoVaultSettings('{not json', inheritable)).toBeNull()
    expect(mergeUserSettingsIntoVaultSettings('[1,2]', inheritable)).toBeNull()
  })

  it('writes nothing when the home file defines no inheritable key', () => {
    expect(mergeUserSettingsIntoVaultSettings('{"theme":"dark"}', {})).toBeNull()
  })

  it('seeds a vault that has no settings.json yet', () => {
    const parsed = JSON.parse(mergeUserSettingsIntoVaultSettings(null, inheritable) ?? '{}')
    expect(parsed.includeCoAuthoredBy).toBe(false)
  })
})

describe('describeSettingInheritance', () => {
  const inheritable = selectInheritableSettings(HOME_SETTINGS)

  it('reports inherited once the vault carries the home value', () => {
    const merged = mergeUserSettingsIntoVaultSettings('{}', inheritable) ?? '{}'
    const vault = JSON.parse(merged)
    for (const key of INHERITABLE_VAULT_SETTING_KEYS) {
      expect(describeSettingInheritance(vault, inheritable, key)).toBe('inherited')
    }
  })

  it('reports stale when home changed after the vault was seeded', () => {
    const vault = { includeCoAuthoredBy: true }
    expect(describeSettingInheritance(vault, inheritable, 'includeCoAuthoredBy')).toBe('stale')
  })

  it('reports stale when a home deny is missing from the vault', () => {
    const vault = { permissions: { defaultMode: 'acceptEdits', allow: [], deny: [] } }
    expect(describeSettingInheritance(vault, inheritable, 'permissions')).toBe('stale')
  })

  it('reports absent when the home file never defined the key', () => {
    expect(describeSettingInheritance({}, {}, 'attribution')).toBe('absent')
  })
})
