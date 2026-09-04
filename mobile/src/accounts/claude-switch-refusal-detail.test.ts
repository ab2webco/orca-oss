import { describe, expect, it, vi } from 'vitest'
import { describeClaudeSwitchRefusal } from './claude-switch-refusal-detail'

const HOST_MESSAGE = 'This Claude account is in use by an assigned worktree.'

function client(response: unknown) {
  return { sendRequest: vi.fn(async () => response as never) }
}

describe('describeClaudeSwitchRefusal', () => {
  it('names the worktree holding the account', async () => {
    const detail = await describeClaudeSwitchRefusal({
      client: client({
        ok: true,
        result: {
          accountId: 'account-a',
          worktrees: [{ worktreeId: 'wt-1', displayName: 'Feature A', hasLiveTerminal: true }],
          liveTerminalCount: 1,
          pendingLaunchCount: 0,
          pendingGlobalLaunchCount: 0,
          blockedByOtherAccounts: [],
          supported: true
        }
      }),
      accountId: 'account-a',
      hostMessage: HOST_MESSAGE
    })
    expect(detail).toBe(
      `${HOST_MESSAGE}\n\nRunning Claude in Feature A. Close it on the desktop, then try again.`
    )
  })

  it('keeps the host message alone when the host reports no holder', async () => {
    const detail = await describeClaudeSwitchRefusal({
      client: client({
        ok: true,
        result: {
          accountId: 'account-a',
          worktrees: [],
          liveTerminalCount: 0,
          pendingLaunchCount: 0,
          pendingGlobalLaunchCount: 0,
          blockedByOtherAccounts: [],
          supported: true
        }
      }),
      accountId: 'account-a',
      hostMessage: HOST_MESSAGE
    })
    expect(detail).toBe(HOST_MESSAGE)
  })

  // Why these three cases are separate: each one is a way the report can fail to
  // arrive, and every one of them would otherwise render as "nothing holds it".
  it('says the holder is unknown when the request is refused', async () => {
    const detail = await describeClaudeSwitchRefusal({
      client: client({ ok: false, error: { message: 'Unknown method' } }),
      accountId: 'account-a',
      hostMessage: HOST_MESSAGE
    })
    expect(detail).toContain('The host did not report which worktree holds it.')
  })

  it('says the holder is unknown when the request throws', async () => {
    const detail = await describeClaudeSwitchRefusal({
      client: {
        sendRequest: vi.fn(async () => {
          throw new Error('socket closed')
        })
      },
      accountId: 'account-a',
      hostMessage: HOST_MESSAGE
    })
    expect(detail).toContain('The host did not report which worktree holds it.')
  })

  it('says the holder is unknown when the report does not decode', async () => {
    const detail = await describeClaudeSwitchRefusal({
      client: client({ ok: true, result: { accountId: 'account-a' } }),
      accountId: 'account-a',
      hostMessage: HOST_MESSAGE
    })
    expect(detail).toContain('The host did not report which worktree holds it.')
  })

  // A remote runtime answers with a well-formed report it could not fill in.
  // Its arrays are empty for a reason that is not "nothing holds the account".
  it('says the holder is unknown when the host reports the lookup unsupported', async () => {
    const detail = await describeClaudeSwitchRefusal({
      client: client({
        ok: true,
        result: {
          accountId: 'account-a',
          worktrees: [],
          liveTerminalCount: 0,
          pendingLaunchCount: 0,
          pendingGlobalLaunchCount: 0,
          blockedByOtherAccounts: [],
          supported: false
        }
      }),
      accountId: 'account-a',
      hostMessage: HOST_MESSAGE
    })
    expect(detail).toContain('The host did not report which worktree holds it.')
  })

  it('keeps a partially decodable report usable instead of degrading it', async () => {
    const detail = await describeClaudeSwitchRefusal({
      client: client({
        ok: true,
        result: {
          accountId: 'account-a',
          worktrees: [{ worktreeId: 'wt-1', displayName: 'Feature A', hasLiveTerminal: true }],
          liveTerminalCount: 'one',
          pendingLaunchCount: null,
          pendingGlobalLaunchCount: undefined,
          blockedByOtherAccounts: 'nope',
          supported: true
        }
      }),
      accountId: 'account-a',
      hostMessage: HOST_MESSAGE
    })
    expect(detail).toContain('Running Claude in Feature A.')
  })

  it('does not ask about a holder when selecting the system default', async () => {
    const request = client({ ok: true, result: null })
    const detail = await describeClaudeSwitchRefusal({
      client: request,
      accountId: null,
      hostMessage: HOST_MESSAGE
    })
    expect(detail).toBe(HOST_MESSAGE)
    expect(request.sendRequest).not.toHaveBeenCalled()
  })
})
