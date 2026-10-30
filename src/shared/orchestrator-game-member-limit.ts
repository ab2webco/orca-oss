import { detectAgentRateLimitOutput } from './agent-rate-limit-detection'
import { accountProviderOfAgent, type GameAccountProvider } from './orchestrator-game-member-agent'
import type { GameAgent } from './orchestrator-game-state'
import {
  EXHAUSTED_USED_PERCENT,
  findUnresetExhaustedWindow,
  getAccountQuotaWindows
} from './rate-limit-exhausted-window'
import type { ProviderRateLimits, RateLimitState } from './rate-limit-types'

/** A member stopped by its account's usage limit; `resetsAt` is Unix ms, null when unknown. */
export type GameMemberLimit = { resetsAt: number | null; spend?: true }

// Why: a spend cap is billed money, which the 5h and 7d readings never count (ORCA-896).
const SPEND_LIMIT_TEXT =
  /\b(?:hit|reached|exceeded)\b[\s\S]{0,60}?\b(?:spend(?:ing)?|billing|credit)\s+limit\b|\/usage-credits\b/i

/** The usage reading Orca holds for one managed account, active or cached. */
export function accountLimitsOf(
  state: Pick<
    RateLimitState,
    'claude' | 'codex' | 'inactiveClaudeAccounts' | 'inactiveCodexAccounts'
  >,
  provider: GameAccountProvider,
  accountId: string,
  activeAccountId: string | null
): ProviderRateLimits | null {
  if (accountId === activeAccountId) {
    return state[provider]
  }
  const cached = provider === 'claude' ? state.inactiveClaudeAccounts : state.inactiveCodexAccounts
  return cached.find((usage) => usage.accountId === accountId)?.rateLimits ?? null
}

const hasQuota = (limits: ProviderRateLimits): boolean => {
  const windows = getAccountQuotaWindows(limits)
  return (
    limits.status === 'ok' &&
    windows.length > 0 &&
    windows.every((window) => window.usedPercent < EXHAUSTED_USED_PERCENT)
  )
}

/** Whether a member that stopped did so on its account's usage limit, and until when. */
export function gameMemberLimitOf(args: {
  state: GameAgent['state']
  agentType: string | null
  accountLimits: ProviderRateLimits | null
  terminalTail: string | null
  now: number
}): GameMemberLimit | null {
  const provider = accountProviderOfAgent(args.agentType)
  // Why not while working: a member still making progress is not stopped, whatever a reading says.
  if (provider === null || args.state === 'working') {
    return null
  }
  const exhausted = args.accountLimits
    ? findUnresetExhaustedWindow(args.accountLimits, args.now)
    : null
  if (exhausted) {
    return { resetsAt: exhausted.resetsAt }
  }
  const said =
    args.terminalTail !== null &&
    detectAgentRateLimitOutput(provider, args.terminalTail, { tail: '' })
  if (said && SPEND_LIMIT_TEXT.test(args.terminalTail ?? '')) {
    return { resetsAt: null, spend: true }
  }
  // Why: like Orca's auto-switch, text on screen is stale once its account verifiably has quota.
  return said && !(args.accountLimits && hasQuota(args.accountLimits)) ? { resetsAt: null } : null
}
