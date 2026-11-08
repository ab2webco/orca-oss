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
