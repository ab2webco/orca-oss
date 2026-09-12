import type { GlobalSettings } from '../../../shared/global-settings-types'
import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../../../shared/managed-account-types'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'
import { isWebClientLocation } from '@/lib/web-client-location'

export type HostLoginAgent = 'claude' | 'codex' | 'github'

export type HostLoginStarted = {
  sessionId: string
  /** The page the user opens in their own browser. */
  url: string
  /** Codex shows this next to the URL; Claude has none and asks for one back. */
  deviceCode: string | null
  /** True when the sign-in needs a code typed back into it. */
  awaitingCode: boolean
}

// Why generous: the user leaves to a browser between the two calls, and the
// second one also imports the credentials on the far side.
const BEGIN_TIMEOUT_MS = 60_000
const COMPLETE_TIMEOUT_MS = 180_000

type Settings = Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined

function requireAccountOwningTarget(settings: Settings): ReturnType<typeof getActiveRuntimeTarget> {
  const target = getActiveRuntimeTarget(settings)
  if (target.kind === 'environment') {
    return target
  }
  // Why the web client counts as an owner while the desktop does not: the page
  // is served BY the runtime that owns the accounts, so its "local" target is
  // that server. Its accounts shim resolves an empty roster for `add`, which is
  // why clicking the button there looked like nothing happened at all.
  if (isWebClientLocation()) {
    return target
  }
  // On a desktop talking to itself the interactive add already works, and
  // running both lanes would create the account twice.
  throw new Error(
    'Host sign-in is only used when a runtime other than this desktop owns the accounts.'
  )
}

/** Ask the account-owning server to start a sign-in and report what to open.
 *  With `accountId`, the server repairs that account instead of adding one. */
export async function beginHostAccountLogin(
  settings: Settings,
  agent: HostLoginAgent,
  accountId: string | null = null
): Promise<HostLoginStarted> {
  return callRuntimeRpc<HostLoginStarted>(
    requireAccountOwningTarget(settings),
    'accounts.beginHostLogin',
    accountId === null ? { agent } : { agent, accountId },
    { timeoutMs: BEGIN_TIMEOUT_MS }
  )
}

/** Hand the server the code the user copied, and get the updated roster back. */
export async function completeHostAccountLogin(
  settings: Settings,
  sessionId: string,
  code: string | null
): Promise<ClaudeRateLimitAccountsState | CodexRateLimitAccountsState> {
  return callRuntimeRpc<ClaudeRateLimitAccountsState | CodexRateLimitAccountsState>(
    requireAccountOwningTarget(settings),
    'accounts.completeHostLogin',
    { sessionId, code },
    { timeoutMs: COMPLETE_TIMEOUT_MS }
  )
}

/** Drop a sign-in the user walked away from, so its temp credentials go too. */
export async function cancelHostAccountLogin(settings: Settings, sessionId: string): Promise<void> {
  await callRuntimeRpc(
    requireAccountOwningTarget(settings),
    'accounts.cancelHostLogin',
    { sessionId },
    { timeoutMs: BEGIN_TIMEOUT_MS }
  )
}
