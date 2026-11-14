import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { isStreamingMethod } from '../core'
import { CLAUDE_LONG_LIVED_TOKEN_METHODS } from './accounts-long-lived-token'

function setTokenMethod() {
  const found = CLAUDE_LONG_LIVED_TOKEN_METHODS.find(
    (m) => m.name === 'accounts.setClaudeLongLivedToken'
  )
  if (!found || isStreamingMethod(found)) {
    throw new Error('accounts.setClaudeLongLivedToken must be a request method')
  }
  return found
}

describe('accounts.setClaudeLongLivedToken', () => {
  it('sets and clears the token for a local-socket caller', async () => {
    const setClaudeLongLivedToken = vi.fn().mockResolvedValue({ accounts: [] })
    const runtime = { setClaudeLongLivedToken } as unknown as OrcaRuntimeService

    await setTokenMethod().handler({ account: 'a@example.com', token: 'fixture' }, { runtime })
    await setTokenMethod().handler({ account: 'a@example.com', token: null }, { runtime })

    expect(setClaudeLongLivedToken).toHaveBeenNthCalledWith(1, 'a@example.com', 'fixture')
    expect(setClaudeLongLivedToken).toHaveBeenNthCalledWith(2, 'a@example.com', null)
  })

  it('refuses paired mobile and remote-runtime callers', async () => {
    const setClaudeLongLivedToken = vi.fn()
    const runtime = { setClaudeLongLivedToken } as unknown as OrcaRuntimeService
    for (const clientKind of ['mobile', 'runtime'] as const) {
      await expect(
        setTokenMethod().handler({ account: 'a', token: 'fixture' }, { runtime, clientKind })
      ).rejects.toThrow(/host runtime/)
    }
    expect(setClaudeLongLivedToken).not.toHaveBeenCalled()
  })
})

function requestMethod(name: string) {
  const found = CLAUDE_LONG_LIVED_TOKEN_METHODS.find((m) => m.name === name)
  if (!found || isStreamingMethod(found)) {
    throw new Error(`${name} must be a request method`)
  }
  return found
}

describe('accounts.*ClaudeSetupToken', () => {
  // Why remote callers pass here: the host mints and stores the token; the caller sends ids and a code.
  it('lets local, paired-mobile and remote-runtime callers drive the sign-in', async () => {
    const runtime = {
      beginClaudeSetupToken: vi.fn().mockResolvedValue({ sessionId: 's1', url: 'https://x' }),
      submitClaudeSetupTokenCode: vi.fn().mockReturnValue({ state: 'verifying' }),
      getClaudeSetupTokenStatus: vi.fn().mockReturnValue({ state: 'stored' }),
      cancelClaudeSetupToken: vi.fn()
    }
    const ctx = (clientKind?: 'mobile' | 'runtime') => ({
      runtime: runtime as unknown as OrcaRuntimeService,
      clientKind
    })
    for (const clientKind of [undefined, 'mobile', 'runtime'] as const) {
      await requestMethod('accounts.beginClaudeSetupToken').handler(
        { account: 'a' },
        ctx(clientKind)
      )
      await requestMethod('accounts.submitClaudeSetupTokenCode').handler(
        { sessionId: 's1', code: 'c' },
        ctx(clientKind)
      )
      await requestMethod('accounts.getClaudeSetupTokenStatus').handler(
        { sessionId: 's1' },
        ctx(clientKind)
      )
      await expect(
        requestMethod('accounts.cancelClaudeSetupToken').handler(
          { sessionId: 's1' },
          ctx(clientKind)
        )
      ).resolves.toEqual({ cancelled: true })
    }
    expect(runtime.beginClaudeSetupToken).toHaveBeenCalledWith('a')
    expect(runtime.submitClaudeSetupTokenCode).toHaveBeenCalledWith('s1', 'c')
    expect(runtime.getClaudeSetupTokenStatus).toHaveBeenCalledWith('s1')
    expect(runtime.cancelClaudeSetupToken).toHaveBeenCalledTimes(3)
  })

  it('takes no token or path from the caller', () => {
    for (const name of [
      'accounts.beginClaudeSetupToken',
      'accounts.submitClaudeSetupTokenCode',
      'accounts.getClaudeSetupTokenStatus',
      'accounts.cancelClaudeSetupToken'
    ]) {
      const shape = Object.keys(
        (requestMethod(name).params as unknown as { shape: Record<string, unknown> }).shape
      )
      expect(shape.filter((key) => /token|path|dir/i.test(key))).toEqual([])
    }
  })
})
