import { describe, expect, it } from 'vitest'
import { automationLaunchAccounts } from './automation-launch-accounts'

const pins = { claudeAccountId: 'claude-acc', codexAccountId: 'codex-acc' }

describe('automationLaunchAccounts', () => {
  it('applies only the Claude pin to a Claude automation', () => {
    expect(automationLaunchAccounts({ agentId: 'claude', command: null, ...pins })).toEqual({
      claudeAccountId: 'claude-acc'
    })
  })

  it('applies only the Codex pin to a Codex automation', () => {
    expect(automationLaunchAccounts({ agentId: 'codex', command: null, ...pins })).toEqual({
      codexAccountId: 'codex-acc'
    })
  })

  it('applies no account to other agents', () => {
    expect(automationLaunchAccounts({ agentId: 'claude-zai', command: null, ...pins })).toEqual({})
  })

  it('applies no account to a command-only automation', () => {
    expect(
      automationLaunchAccounts({
        agentId: null,
        command: { command: 'echo hi', timeoutSeconds: 30 },
        ...pins
      })
    ).toEqual({})
  })

  it('inherits when the matching pin is null or absent', () => {
    expect(automationLaunchAccounts({ agentId: 'claude', claudeAccountId: null })).toEqual({})
    expect(automationLaunchAccounts({ agentId: 'codex' })).toEqual({})
  })
})
