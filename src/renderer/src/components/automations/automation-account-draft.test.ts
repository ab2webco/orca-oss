import { describe, expect, it } from 'vitest'
import { accountDraftFromAutomation, automationAccountSaveFields } from './automation-account-draft'

describe('accountDraftFromAutomation', () => {
  it('hydrates the saved pins and treats absent as inherit', () => {
    expect(
      accountDraftFromAutomation({ claudeAccountId: 'acct-a', codexAccountId: undefined })
    ).toEqual({ claudeAccountId: 'acct-a', codexAccountId: null })
    expect(accountDraftFromAutomation({ claudeAccountId: null, codexAccountId: 'cx-1' })).toEqual({
      claudeAccountId: null,
      codexAccountId: 'cx-1'
    })
  })
})

describe('automationAccountSaveFields', () => {
  const pinned = { actionKind: 'agent', claudeAccountId: 'acct-a', codexAccountId: null } as const

  it('sends explicit null on update so clearing a pin reaches the store', () => {
    expect(automationAccountSaveFields(pinned, 'update')).toEqual({
      claudeAccountId: 'acct-a',
      codexAccountId: null
    })
  })

  it('omits inherit fields on create so older hosts see an unchanged payload', () => {
    expect(automationAccountSaveFields(pinned, 'create')).toEqual({ claudeAccountId: 'acct-a' })
    expect(automationAccountSaveFields({ ...pinned, claudeAccountId: null }, 'create')).toEqual({})
  })

  it('clears both pins for a command-only automation', () => {
    expect(automationAccountSaveFields({ ...pinned, actionKind: 'command' }, 'update')).toEqual({
      claudeAccountId: null,
      codexAccountId: null
    })
    expect(automationAccountSaveFields({ ...pinned, actionKind: 'command' }, 'create')).toEqual({})
  })
})
