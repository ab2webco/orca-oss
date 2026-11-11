import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-result'

// Why longer than a read: the host waits out a restoring lead before it reopens the conversation.
const REOPEN_TIMEOUT_MS = 45_000

export type TeamLeadReopen =
  | { kind: 'lead'; handle: string }
  | { kind: 'failed'; reason: string }
  | { kind: 'nothing-kept' }
  | { kind: 'unsupported' }

type CallRpc = (target: RuntimeClientTarget, method: string, params: unknown) => Promise<unknown>

const callReopen: CallRpc = (target, method, params) =>
  callRuntimeRpc<unknown>(target, method, params, { timeoutMs: REOPEN_TIMEOUT_MS })

const handleOf = (value: unknown): string | null => {
  const handle = (value as { handle?: unknown } | undefined)?.handle
  return typeof handle === 'string' ? handle : null
}

/** Reopens the project's kept lead on the host, which opens its pane; the menu opens none (ORCA-717). */
export async function reopenTeamLead(
  target: RuntimeClientTarget,
  args: { worktreeId: string; project: string },
  call: CallRpc = callReopen
): Promise<TeamLeadReopen> {
  let result: { resumed?: unknown; live?: unknown; resumeError?: unknown } | null
  try {
    result = (await call(target, 'game.leadReopen', { ...args, label: '' })) as typeof result
  } catch (error) {
    if (hasRuntimeRpcErrorCode(error, 'method_not_found')) {
      return { kind: 'unsupported' }
    }
    throw error
  }
  const handle = handleOf(result?.resumed) ?? handleOf(result?.live)
  if (handle) {
    return { kind: 'lead', handle }
  }
  return typeof result?.resumeError === 'string'
    ? { kind: 'failed', reason: result.resumeError }
    : { kind: 'nothing-kept' }
}
