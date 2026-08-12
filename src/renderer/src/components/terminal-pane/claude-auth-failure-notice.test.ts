import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  describeClaudeAuthFailure,
  resolveClaudeAuthFailurePaneAccount
} from './claude-auth-failure-notice'

const settings = {
  claudeManagedAccounts: [
    { id: 'acct_1', email: 'fabiana@koombea.com' },
    { id: 'acct_2', email: 'scloud@koombea.com' }
  ],
  activeClaudeManagedAccountId: 'acct_2'
}

vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ settings }) }
}))

const getLivePtyAccount = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as { window: unknown }).window = {
    api: { claudeAccounts: { getLivePtyAccount } }
  }
})

describe('resolveClaudeAuthFailurePaneAccount', () => {
  it('names the account the pane actually runs on, not the global selection', async () => {
    getLivePtyAccount.mockResolvedValue({ accountId: 'acct_1', injected: true })

    await expect(resolveClaudeAuthFailurePaneAccount('pty-1')).resolves.toEqual({
      kind: 'account',
      email: 'fabiana@koombea.com'
    })
  })

  it('reports the shared runtime login rather than guessing an account', async () => {
    getLivePtyAccount.mockResolvedValue({ accountId: null, injected: false })

    await expect(resolveClaudeAuthFailurePaneAccount('pty-1')).resolves.toEqual({ kind: 'shared' })
  })

  it('stays unknown when the runtime holds no binding for the pane', async () => {
    getLivePtyAccount.mockResolvedValue(null)

    await expect(resolveClaudeAuthFailurePaneAccount('pty-1')).resolves.toEqual({ kind: 'unknown' })
  })

  it('stays unknown when the bound account id is no longer in the roster', async () => {
    getLivePtyAccount.mockResolvedValue({ accountId: 'acct_gone', injected: true })

    await expect(resolveClaudeAuthFailurePaneAccount('pty-1')).resolves.toEqual({ kind: 'unknown' })
  })

  it('stays unknown when the lookup throws', async () => {
    getLivePtyAccount.mockRejectedValue(new Error('runtime gone'))

    await expect(resolveClaudeAuthFailurePaneAccount('pty-1')).resolves.toEqual({ kind: 'unknown' })
  })
})

describe('describeClaudeAuthFailure', () => {
  it('puts the account email in the message', () => {
    expect(describeClaudeAuthFailure({ kind: 'account', email: 'fabiana@koombea.com' })).toContain(
      'fabiana@koombea.com'
    )
  })

  it('never names an account it could not resolve', () => {
    expect(describeClaudeAuthFailure({ kind: 'unknown' })).not.toContain('@')
    expect(describeClaudeAuthFailure({ kind: 'shared' })).not.toContain('@')
  })
})
