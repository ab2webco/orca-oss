import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  describeClaudeAuthFailure,
  notifyClaudeAuthFailure,
  resolveClaudeAuthFailurePaneAccount
} from './claude-auth-failure-notice'

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))

vi.mock('sonner', () => ({ toast: { error: toastError } }))

const PANE_BOUND_AT = 1_700_000_000_000

const settings = {
  claudeManagedAccounts: [
    { id: 'acct_1', email: 'fabiana@koombea.com', lastAuthenticatedAt: PANE_BOUND_AT - 60_000 },
    { id: 'acct_2', email: 'scloud@koombea.com', lastAuthenticatedAt: PANE_BOUND_AT - 60_000 }
  ],
  activeClaudeManagedAccountId: 'acct_2'
}

vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ settings }) }
}))

const getLivePtyAccount = vi.fn()
const recordClaudeCredentialRejection = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as { window: unknown }).window = {
    api: {
      claudeAccounts: { getLivePtyAccount },
      rateLimits: { recordClaudeCredentialRejection }
    }
  }
})

describe('resolveClaudeAuthFailurePaneAccount', () => {
  it('names the account the pane actually runs on, not the global selection', async () => {
    getLivePtyAccount.mockResolvedValue({ accountId: 'acct_1', injected: true })

    await expect(resolveClaudeAuthFailurePaneAccount('pty-1', PANE_BOUND_AT)).resolves.toEqual({
      kind: 'account',
      accountId: 'acct_1',
      email: 'fabiana@koombea.com'
    })
  })

  it('blames the pane, not the credential, when the account was re-authenticated after it started', async () => {
    getLivePtyAccount.mockResolvedValue({ accountId: 'acct_1', injected: true })

    await expect(
      resolveClaudeAuthFailurePaneAccount('pty-1', PANE_BOUND_AT - 120_000)
    ).resolves.toEqual({
      kind: 'reauthenticated-since',
      accountId: 'acct_1',
      email: 'fabiana@koombea.com'
    })
  })

  it('reports the shared runtime login rather than guessing an account', async () => {
    getLivePtyAccount.mockResolvedValue({ accountId: null, injected: false })

    await expect(resolveClaudeAuthFailurePaneAccount('pty-1', PANE_BOUND_AT)).resolves.toEqual({
      kind: 'shared'
    })
  })

  it('stays unknown when the runtime holds no binding for the pane', async () => {
    getLivePtyAccount.mockResolvedValue(null)

    await expect(resolveClaudeAuthFailurePaneAccount('pty-1', PANE_BOUND_AT)).resolves.toEqual({
      kind: 'unknown'
    })
  })

  it('stays unknown when the bound account id is no longer in the roster', async () => {
    getLivePtyAccount.mockResolvedValue({ accountId: 'acct_gone', injected: true })

    await expect(resolveClaudeAuthFailurePaneAccount('pty-1', PANE_BOUND_AT)).resolves.toEqual({
      kind: 'unknown'
    })
  })

  it('stays unknown when the lookup throws', async () => {
    getLivePtyAccount.mockRejectedValue(new Error('runtime gone'))

    await expect(resolveClaudeAuthFailurePaneAccount('pty-1', PANE_BOUND_AT)).resolves.toEqual({
      kind: 'unknown'
    })
  })
})

describe('notifyClaudeAuthFailure', () => {
  it('marks the resolved managed account rejected before showing the named failure', async () => {
    getLivePtyAccount.mockResolvedValue({ accountId: 'acct_1', injected: true })

    await notifyClaudeAuthFailure('pty-1', PANE_BOUND_AT)

    expect(recordClaudeCredentialRejection).toHaveBeenCalledWith('acct_1')
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('fabiana@koombea.com'), {
      duration: 15_000
    })
  })

  it('never re-fails a credential the user already replaced, and says the pane is the stale one', async () => {
    getLivePtyAccount.mockResolvedValue({ accountId: 'acct_1', injected: true })

    await notifyClaudeAuthFailure('pty-1', PANE_BOUND_AT - 120_000)

    expect(recordClaudeCredentialRejection).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining('re-authenticated after this pane started'),
      { duration: 15_000 }
    )
  })

  it('does not poison account state when remote ownership cannot be resolved', async () => {
    getLivePtyAccount.mockResolvedValue(null)

    await notifyClaudeAuthFailure('remote-pty', PANE_BOUND_AT)

    expect(recordClaudeCredentialRejection).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('could not tell'), {
      duration: 15_000
    })
  })

  it('still names the account when publishing the verdict fails', async () => {
    getLivePtyAccount.mockResolvedValue({ accountId: 'acct_1', injected: true })
    recordClaudeCredentialRejection.mockRejectedValue(new Error('main unavailable'))

    await notifyClaudeAuthFailure('pty-1', PANE_BOUND_AT)

    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('fabiana@koombea.com'), {
      duration: 15_000
    })
  })
})

describe('describeClaudeAuthFailure', () => {
  it('puts the account email in the message', () => {
    expect(
      describeClaudeAuthFailure({
        kind: 'account',
        accountId: 'acct_1',
        email: 'fabiana@koombea.com'
      })
    ).toContain('fabiana@koombea.com')
  })

  it('points at the pane when the credential was already replaced', () => {
    const message = describeClaudeAuthFailure({
      kind: 'reauthenticated-since',
      accountId: 'acct_1',
      email: 'fabiana@koombea.com'
    })

    expect(message).toContain('fabiana@koombea.com')
    expect(message).toContain('re-authenticated after this pane started')
  })

  it('never names an account it could not resolve', () => {
    expect(describeClaudeAuthFailure({ kind: 'unknown' })).not.toContain('@')
    expect(describeClaudeAuthFailure({ kind: 'shared' })).not.toContain('@')
  })
})
