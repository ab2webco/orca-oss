import type { ClaudeRateLimitAccountsState } from './managed-account-types'

export type ClaudeSetupTokenState = 'awaiting-code' | 'verifying' | 'stored' | 'failed'

export type ClaudeSetupTokenStarted = { sessionId: string; url: string }

/** Never carries the token: only whether the host stored it, and the roster after. */
export type ClaudeSetupTokenStatus = {
  state: ClaudeSetupTokenState
  error: string | null
  accounts: ClaudeRateLimitAccountsState | null
}
