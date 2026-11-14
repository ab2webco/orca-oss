import { z } from 'zod'
import { defineMethod, type RpcAnyMethod } from '../core'

// Why null clears: one method keeps set and clear on the same host-local guard.
const SetClaudeLongLivedTokenParams = z.object({
  account: z.string().min(1, 'Missing account').max(512),
  token: z.string().min(1, 'Missing token').max(8_192).nullable()
})

const ClaudeSetupTokenSessionParams = z.object({
  sessionId: z.string().min(1, 'Missing sessionId').max(128)
})

const SubmitClaudeSetupTokenCodeParams = ClaudeSetupTokenSessionParams.extend({
  code: z.string().min(1, 'Missing code').max(2_048)
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
  }),
  // Why these four have no clientKind guard: the host mints and stores the token itself,
  // so a paired caller only ever sends an account id and the code from the sign-in page.
  defineMethod({
    name: 'accounts.beginClaudeSetupToken',
    params: z.object({ account: z.string().min(1, 'Missing account').max(512) }),
    handler: async (params, { runtime }) => runtime.beginClaudeSetupToken(params.account)
  }),
  defineMethod({
    name: 'accounts.submitClaudeSetupTokenCode',
    params: SubmitClaudeSetupTokenCodeParams,
    handler: async (params, { runtime }) =>
      runtime.submitClaudeSetupTokenCode(params.sessionId, params.code)
  }),
  defineMethod({
    name: 'accounts.getClaudeSetupTokenStatus',
    params: ClaudeSetupTokenSessionParams,
    handler: async (params, { runtime }) => runtime.getClaudeSetupTokenStatus(params.sessionId)
  }),
  defineMethod({
    name: 'accounts.cancelClaudeSetupToken',
    params: ClaudeSetupTokenSessionParams,
    handler: async (params, { runtime }) => {
      runtime.cancelClaudeSetupToken(params.sessionId)
      return { cancelled: true }
    }
  })
]
