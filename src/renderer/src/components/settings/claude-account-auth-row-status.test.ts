import { describe, expect, it } from 'vitest'
import type { RateLimitState } from '../../../../shared/rate-limit-types'
import { unverifiedClaudeAccountAuthVerdict } from '../../../../shared/claude-account-auth-verdict'
import {
  findClaudeAccountAuthVerdict,
  resolveClaudeAccountAuthRowStatus,
  selectClaudeAccountUsage
} from './claude-account-auth-row-status'

const NOW = 1_760_000_000_000

function state(overrides: Partial<RateLimitState> = {}): RateLimitState {
  return {
    claude: null,
    codex: null,
    gemini: null,
    opencodeGo: null,
    kimi: null,
    antigravity: null,
    minimax: null,
    grok: null,
    minimaxCookieConfigured: false,
    grokAuthConfigured: false,
    claudeTarget: { runtime: 'host', wslDistro: null },
    codexTarget: { runtime: 'host', wslDistro: null },
    inactiveClaudeAccounts: [],
    inactiveCodexAccounts: [],
    ...overrides
  }
}

describe('resolveClaudeAccountAuthRowStatus', () => {
  it('shows an unchecked row when nothing has verified the account', () => {
    expect(resolveClaudeAccountAuthRowStatus(null)).toMatchObject({
      tone: 'neutral',
      kind: 'unchecked'
    })
  })

  it('marks a rejected credential negative so a dead row cannot look like the others', () => {
    expect(
      resolveClaudeAccountAuthRowStatus({
        ...unverifiedClaudeAccountAuthVerdict('acct_1'),
        state: 'failed',
        failure: 'credential-rejected',
        checkedAt: NOW
      })
    ).toMatchObject({ tone: 'negative', kind: 'credential-rejected', checkedAt: NOW })
  })

  it('distinguishes a missing credential from a rejected one', () => {
    expect(
      resolveClaudeAccountAuthRowStatus({
        ...unverifiedClaudeAccountAuthVerdict('acct_1'),
        state: 'failed',
        failure: 'no-credentials',
        checkedAt: NOW
      }).kind
    ).toBe('no-credentials')
  })

  it('keeps the verified state visible while flagging an undecided later check', () => {
    expect(
      resolveClaudeAccountAuthRowStatus({
        ...unverifiedClaudeAccountAuthVerdict('acct_1'),
        state: 'authenticated',
        checkedAt: NOW,
        undecided: 'network',
        undecidedAt: NOW + 1000
      })
    ).toMatchObject({ tone: 'positive', kind: 'verified', undecided: 'network' })
  })

  it('reports an in-flight check without claiming a result', () => {
    expect(
      resolveClaudeAccountAuthRowStatus({
        ...unverifiedClaudeAccountAuthVerdict('acct_1'),
        checking: true
      })
    ).toMatchObject({ kind: 'checking', tone: 'neutral' })
  })
})

describe('selectClaudeAccountUsage', () => {
  it('reads the active account from the active provider slot, not the inactive array', () => {
    const active = {
      provider: 'claude' as const,
      session: { usedPercent: 20, windowMinutes: 300, resetsAt: null, resetDescription: null },
      weekly: null,
      updatedAt: NOW,
      error: null,
      status: 'ok' as const
    }
    expect(selectClaudeAccountUsage(state({ claude: active }), 'acct_1', true)).toBe(active)
  })

  it('returns null for an inactive account with no cached usage', () => {
    expect(selectClaudeAccountUsage(state(), 'acct_1', false)).toBeNull()
  })
})

describe('findClaudeAccountAuthVerdict', () => {
  it('degrades to null when the runtime sent no verdicts at all', () => {
    expect(findClaudeAccountAuthVerdict(state(), 'acct_1')).toBeNull()
  })
})
