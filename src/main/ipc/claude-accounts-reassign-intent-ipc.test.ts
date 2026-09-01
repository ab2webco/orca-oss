import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeWorktreeAccountReassignment } from '../../shared/claude-account-worktree-usage'

type Handler = (event: unknown, args: unknown) => unknown

const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    }
  }
}))

const { registerClaudeAccountHandlers } = await import('./claude-accounts')

function invokeReassign(args: unknown): unknown {
  const handler = handlers.get('claudeAccounts:reassignWorktrees')
  if (!handler) {
    throw new Error('reassign handler was not registered')
  }
  return handler({}, args)
}

describe('claudeAccounts:reassignWorktrees intent', () => {
  let received: ClaudeWorktreeAccountReassignment[]

  beforeEach(() => {
    handlers.clear()
    received = []
    const claudeAccounts = {
      reassignWorktreeAccountPins: (request: ClaudeWorktreeAccountReassignment) => {
        received.push(request)
        return Promise.resolve({})
      }
    }
    registerClaudeAccountHandlers(
      claudeAccounts as never,
      { getSettings: () => ({ claudeManagedAccounts: [] }) } as never
    )
  })

  it('forwards a keep-pins re-auth without a destination', () => {
    invokeReassign({
      fromAccountId: 'account-a',
      intent: 'keep-pins',
      closeLiveTerminals: true
    })

    expect(received).toEqual([
      {
        fromAccountId: 'account-a',
        intent: 'keep-pins',
        closeLiveTerminals: true,
        closeLiveTerminalAccountIds: undefined
      }
    ])
  })

  it('refuses a request whose intent did not survive the wire', () => {
    // Why this matters: without the discriminant the handler would rebuild a
    // `reassign` to `null` and unpin every worktree to the system default.
    expect(() => invokeReassign({ fromAccountId: 'account-a', closeLiveTerminals: true })).toThrow(
      'Unknown Claude worktree reassignment intent.'
    )
    expect(received).toEqual([])
  })
})
