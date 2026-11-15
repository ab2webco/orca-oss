import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const FIXTURE_TOKEN = 'fixture-long-lived-token'

function invokeSetToken(args: unknown): unknown {
  const handler = handlers.get('claudeAccounts:setLongLivedToken')
  if (!handler) {
    throw new Error('setLongLivedToken handler was not registered')
  }
  return handler({}, args)
}

describe('claudeAccounts:setLongLivedToken', () => {
  let received: [string, string | null][]

  beforeEach(() => {
    handlers.clear()
    received = []
    const claudeAccounts = {
      setLongLivedToken: (accountId: string, token: string | null) => {
        received.push([accountId, token])
        return Promise.resolve({})
      }
    }
    registerClaudeAccountHandlers(
      claudeAccounts as never,
      { getSettings: () => ({ claudeManagedAccounts: [] }) } as never
    )
  })

  it('stores a token for one account', () => {
    invokeSetToken({ accountId: 'account-a', token: FIXTURE_TOKEN })
    expect(received).toEqual([['account-a', FIXTURE_TOKEN]])
  })

  it('clears the token when the renderer sends null', () => {
    invokeSetToken({ accountId: 'account-a', token: null })
    expect(received).toEqual([['account-a', null]])
  })

  it('refuses a malformed request without echoing its token', () => {
    expect(() => invokeSetToken({ accountId: 42, token: FIXTURE_TOKEN })).toThrow(
      'Invalid long-lived token request.'
    )
    expect(() => invokeSetToken({ accountId: 'account-a', token: 7 })).toThrow(
      'Invalid long-lived token request.'
    )
    expect(() => invokeSetToken({ accountId: 'account-a' })).toThrow(
      'Invalid long-lived token request.'
    )
    expect(received).toEqual([])
  })
})

describe('claudeAccounts:addFromLongLivedToken (ORCA-1215)', () => {
  let received: [string, string][]

  function invokeAdd(args: unknown): unknown {
    const handler = handlers.get('claudeAccounts:addFromLongLivedToken')
    if (!handler) {
      throw new Error('addFromLongLivedToken handler was not registered')
    }
    return handler({}, args)
  }

  beforeEach(() => {
    handlers.clear()
    received = []
    const claudeAccounts = {
      addLongLivedTokenAccount: (label: string, token: string) => {
        received.push([label, token])
        return Promise.resolve({})
      }
    }
    registerClaudeAccountHandlers(
      claudeAccounts as never,
      { getSettings: () => ({ claudeManagedAccounts: [] }) } as never
    )
  })

  it('adds an account from a label and a pasted token', () => {
    invokeAdd({ label: 'Team Max', token: FIXTURE_TOKEN })
    expect(received).toEqual([['Team Max', FIXTURE_TOKEN]])
  })

  it('refuses a malformed request without echoing its token', () => {
    for (const args of [{ label: 7, token: FIXTURE_TOKEN }, { label: 'x', token: null }, null]) {
      let message = ''
      try {
        invokeAdd(args)
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).toBe('Invalid token account request.')
    }
    expect(received).toEqual([])
  })
})
