import { describe, expect, it } from 'vitest'
import { formatVaultSettingsInheritance } from './account-settings-inheritance-format'

describe('formatVaultSettingsInheritance', () => {
  it('prints nothing for a runtime older than ORCA-189 rather than implying nothing inherited', () => {
    expect(formatVaultSettingsInheritance(undefined)).toBe('')
  })

  it('says not applicable for a pane that reads ~/.claude directly', () => {
    const line = formatVaultSettingsInheritance({ state: 'not-applicable', reason: 'shared-home' })
    expect(line).toContain('not applicable')
    expect(line).toContain('reads ~/.claude directly')
  })

  it('names the stale key and how to pick it up', () => {
    const line = formatVaultSettingsInheritance({
      state: 'vault',
      accountId: 'acct-1',
      keys: [
        { key: 'includeCoAuthoredBy', state: 'inherited' },
        { key: 'attribution', state: 'stale' }
      ]
    })
    expect(line).toContain('inherited includeCoAuthoredBy')
    expect(line).toContain('attribution stale')
    expect(line).toContain('relaunch')
  })

  it('survives a newer runtime: unknown reasons and states print instead of crashing', () => {
    const unknownReason = formatVaultSettingsInheritance({
      state: 'not-applicable',
      reason: 'some-future-reason'
    } as never)
    expect(unknownReason).toContain('some-future-reason')
    expect(unknownReason).not.toContain('undefined')

    const unknownState = formatVaultSettingsInheritance({
      state: 'vault',
      accountId: 'acct-1',
      keys: [{ key: 'permissions', state: 'conflicted' }]
    } as never)
    expect(unknownState).toContain('permissions conflicted')

    expect(() =>
      formatVaultSettingsInheritance({ state: 'vault', accountId: 'acct-1' } as never)
    ).not.toThrow()
  })

  it('separates a key absent at home from one that could not resolve', () => {
    const line = formatVaultSettingsInheritance({
      state: 'vault',
      accountId: 'acct-1',
      keys: [
        { key: 'outputStyle', state: 'unresolved' },
        { key: 'permissions', state: 'absent' }
      ]
    })
    expect(line).toContain('outputStyle unresolved')
    expect(line).toContain('not set at home: permissions')
    expect(line).toContain('inherited nothing')
  })
})
