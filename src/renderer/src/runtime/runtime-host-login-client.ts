import type { GlobalSettings } from '../../../shared/global-settings-types'
import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../../../shared/managed-account-types'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'

export type HostLoginAgent = 'claude' | 'codex'

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

function requireRemoteTarget(settings: Settings): ReturnType<typeof getActiveRuntimeTarget> {
  const target = getActiveRuntimeTarget(settings)
  if (target.kind !== 'environment') {
    // Why refuse instead of falling back to the desktop flow: this lane exists
    // for the server that owns the accounts. On the local host the interactive
    // add already works and running both would create the account twice.
    throw new Error('Host sign-in is only used when an Orca server owns the accounts.')
  }
  return target
}

/** Ask the account-owning server to start a sign-in and report what to open. */
export async function beginHostAccountLogin(
  settings: Settings,
  agent: HostLoginAgent
): Promise<HostLoginStarted> {
  return callRuntimeRpc<HostLoginStarted>(
    requireRemoteTarget(settings),
    'accounts.beginHostLogin',
    { agent },
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
    requireRemoteTarget(settings),
    'accounts.completeHostLogin',
    { sessionId, code },
    { timeoutMs: COMPLETE_TIMEOUT_MS }
  )
}

/** Drop a sign-in the user walked away from, so its temp credentials go too. */
export async function cancelHostAccountLogin(
  settings: Settings,
  sessionId: string
): Promise<void> {
  await callRuntimeRpc(
    requireRemoteTarget(settings),
    'accounts.cancelHostLogin',
    { sessionId },
    { timeoutMs: BEGIN_TIMEOUT_MS }
  )
}
