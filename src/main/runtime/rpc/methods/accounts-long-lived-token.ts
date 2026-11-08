import { z } from 'zod'
import { defineMethod, type RpcAnyMethod } from '../core'

// Why null clears: one method keeps set and clear on the same host-local guard.
const SetClaudeLongLivedTokenParams = z.object({
  account: z.string().min(1, 'Missing account').max(512),
  token: z.string().min(1, 'Missing token').max(8_192).nullable()
})

export const CLAUDE_LONG_LIVED_TOKEN_METHODS: readonly RpcAnyMethod[] = [
  defineMethod({
    name: 'accounts.setClaudeLongLivedToken',
    params: SetClaudeLongLivedTokenParams,
    handler: async (params, { runtime, clientKind }) => {
      // Why: the token authenticates this host's vault; only a local caller on the host sets it.
      if (clientKind !== undefined) {
        throw new Error('Long-lived tokens can only be set on the Orca Lab host runtime.')
      }
      return runtime.setClaudeLongLivedToken(params.account, params.token)
    }
  })
]
