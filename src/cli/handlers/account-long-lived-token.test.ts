import { describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch'
import type { RuntimeClient } from '../runtime-client'
import { CLAUDE_LONG_LIVED_TOKEN_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import { runAccountTokenClear, runAccountTokenSet } from './account-long-lived-token'

const FAKE_TOKEN = 'fixture-token-not-a-real-credential'

function context(flags: Record<string, string | boolean>, capabilities: string[]) {
  const call = vi.fn(async (method: string) =>
    method === 'status.get'
      ? { result: { capabilities } }
      : { result: { accounts: [], activeAccountId: null } }
  )
  const ctx: HandlerContext = {
    flags: new Map(Object.entries(flags)),
    client: { call } as unknown as RuntimeClient,
    cwd: '/',
    json: true
  }
  return { ctx, call }
}

describe('orca account token', () => {
  it('sends the token read from the reader, never from a flag', async () => {
    const { ctx, call } = context({ account: 'a@example.com' }, [
      CLAUDE_LONG_LIVED_TOKEN_RUNTIME_CAPABILITY
    ])
    const readToken = vi.fn(async () => `${FAKE_TOKEN}\n`)

    await runAccountTokenSet(ctx, readToken)

    expect(call).toHaveBeenCalledWith('accounts.setClaudeLongLivedToken', {
      account: 'a@example.com',
      token: `${FAKE_TOKEN}\n`
    })
  })

  it('rejects a token passed on the command line', async () => {
    const { ctx, call } = context({ account: 'a', token: FAKE_TOKEN }, [
      CLAUDE_LONG_LIVED_TOKEN_RUNTIME_CAPABILITY
    ])
    await expect(runAccountTokenSet(ctx, vi.fn())).rejects.toThrow(/stdin/)
    expect(call).not.toHaveBeenCalledWith('accounts.setClaudeLongLivedToken', expect.anything())
  })

  it('checks the runtime supports tokens before reading the secret', async () => {
    const { ctx } = context({ account: 'a' }, [])
    const readToken = vi.fn(async () => FAKE_TOKEN)
    await expect(runAccountTokenSet(ctx, readToken)).rejects.toThrow(/too old/)
    expect(readToken).not.toHaveBeenCalled()
  })

  it('requires --account and clears with a null token', async () => {
    const missing = context({}, [CLAUDE_LONG_LIVED_TOKEN_RUNTIME_CAPABILITY])
    await expect(runAccountTokenClear(missing.ctx)).rejects.toThrow(/--account/)

    const { ctx, call } = context({ account: 'acct-1' }, [
      CLAUDE_LONG_LIVED_TOKEN_RUNTIME_CAPABILITY
    ])
    await runAccountTokenClear(ctx)
    expect(call).toHaveBeenCalledWith('accounts.setClaudeLongLivedToken', {
      account: 'acct-1',
      token: null
    })
  })
})
