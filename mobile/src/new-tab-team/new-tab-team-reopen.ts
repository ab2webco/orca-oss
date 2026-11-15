import type { RpcClient } from '../transport/rpc-client'

// Why longer than a read: the host waits out a restoring lead before it reopens the conversation.
const REOPEN_TIMEOUT_MS = 45_000

export type TeamLeadReopen =
  | { kind: 'lead' }
  | { kind: 'failed'; reason: string }
  | { kind: 'nothing-kept' }
  | { kind: 'unsupported' }

const hasHandle = (value: unknown): boolean =>
  typeof (value as { handle?: unknown } | undefined)?.handle === 'string'

/** Reopens the project's kept lead on the host, which opens its pane (desktop: reopenTeamLead). */
export async function reopenTeamLeadFromPhone(
  client: RpcClient,
  args: { worktreeId: string; project: string }
): Promise<TeamLeadReopen> {
  try {
    const response = await client.sendRequest(
      'game.leadReopen',
      { ...args, label: '' },
      { timeoutMs: REOPEN_TIMEOUT_MS }
    )
    if (!response.ok) {
      const { code, message } = response.error
      return code === 'forbidden' || code === 'method_not_found'
        ? { kind: 'unsupported' }
        : { kind: 'failed', reason: message }
    }
    const result = response.result as { resumed?: unknown; live?: unknown; resumeError?: unknown }
    if (hasHandle(result?.resumed) || hasHandle(result?.live)) {
      return { kind: 'lead' }
    }
    return typeof result?.resumeError === 'string'
      ? { kind: 'failed', reason: result.resumeError }
      : { kind: 'nothing-kept' }
  } catch (error) {
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) }
  }
}
