import type { GlobalSettings } from '../../../shared/global-settings-types'
import type {
  ClaudeSetupTokenStarted,
  ClaudeSetupTokenStatus
} from '../../../shared/claude-setup-token-types'
import { getActiveRuntimeTarget } from './runtime-client-target'
import { callRuntimeRpc } from './runtime-rpc-client'

type Settings = Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined

// Why the active target and not always local: the token is minted on the host that owns the account.
function call<T>(settings: Settings, method: string, params: object, timeoutMs?: number) {
  return callRuntimeRpc<T>(getActiveRuntimeTarget(settings), method, params, { timeoutMs })
}

export function beginClaudeSetupToken(settings: Settings, accountId: string) {
  // Why generous: the host spawns the CLI and waits for it to print the sign-in link.
  return call<ClaudeSetupTokenStarted>(
    settings,
    'accounts.beginClaudeSetupToken',
    { account: accountId },
    60_000
  )
}

// Why a label and no token: the host mints the token and adds the account itself (ORCA-1215).
export function beginClaudeSetupTokenForNewAccount(settings: Settings, label: string) {
  return call<ClaudeSetupTokenStarted>(
    settings,
    'accounts.beginClaudeSetupTokenForNewAccount',
    { label },
    60_000
  )
}

export function submitClaudeSetupTokenCode(settings: Settings, sessionId: string, code: string) {
  return call<ClaudeSetupTokenStatus>(settings, 'accounts.submitClaudeSetupTokenCode', {
    sessionId,
    code
  })
}

export function getClaudeSetupTokenStatus(settings: Settings, sessionId: string) {
  return call<ClaudeSetupTokenStatus>(settings, 'accounts.getClaudeSetupTokenStatus', {
    sessionId
  })
}

export async function cancelClaudeSetupToken(settings: Settings, sessionId: string): Promise<void> {
  await call(settings, 'accounts.cancelClaudeSetupToken', { sessionId })
}
