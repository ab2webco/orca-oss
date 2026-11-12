import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-result'

const STORED_LEAD_TIMEOUT_MS = 15_000

export type StoredTeamLead = { accountId: string | null } | null | 'unknown'

type CallRpc = (target: RuntimeClientTarget, method: string, params: unknown) => Promise<unknown>

const callStoredLead: CallRpc = (target, method, params) =>
  callRuntimeRpc<unknown>(target, method, params, { timeoutMs: STORED_LEAD_TIMEOUT_MS })

function parseStoredLead(result: unknown): StoredTeamLead {
  const stored = (result as { stored?: unknown } | null)?.stored
  if (stored === null) {
    return null
  }
  const accountId = (stored as { accountId?: unknown } | undefined)?.accountId
  if (accountId === null || typeof accountId === 'string') {
    return { accountId }
  }
  return 'unknown'
}

/** The worktree project's kept lead conversation; 'unknown' when the host cannot say, so no Reopen is offered. */
export async function readStoredTeamLead(
  target: RuntimeClientTarget,
  worktreeId: string,
  call: CallRpc = callStoredLead
): Promise<StoredTeamLead> {
  try {
    return parseStoredLead(await call(target, 'game.leadStored', { worktreeId }))
  } catch (error) {
    if (hasRuntimeRpcErrorCode(error, 'method_not_found')) {
      return 'unknown'
    }
    throw error
  }
}
