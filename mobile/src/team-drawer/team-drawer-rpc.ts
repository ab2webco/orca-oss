import type { RpcClient } from '../transport/rpc-client'

export type LeadGameStateRead = { status: 'ok'; state: unknown } | { status: 'unavailable' }

// Why forbidden too: a host whose mobile allowlist predates the Team drawer refuses before dispatch.
const UNAVAILABLE_CODES = new Set(['method_not_found', 'forbidden'])

/** The same `game state` the desktop Panel reads; the pane key is what finds the lead's members. */
export async function readLeadGameState(
  client: RpcClient,
  caller: { worktreeId: string; terminalHandle: string; paneKey: string }
): Promise<LeadGameStateRead> {
  const response = await client.sendRequest('game.state', caller)
  if (!response.ok) {
    if (UNAVAILABLE_CODES.has(response.error.code)) {
      return { status: 'unavailable' }
    }
    throw new Error(response.error.message)
  }
  return { status: 'ok', state: response.result }
}
