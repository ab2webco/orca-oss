import type { HostTerminalOpenRequest } from '../session/host-terminal-open'
import type { RpcClient } from '../transport/rpc-client'

export const FRESH_LEAD_PROMPT = '/orca-game:lead fresh'

// Why longer than a read: the host spawns the agent and its shell before it answers.
const CREATE_TIMEOUT_MS = 60_000

export type FreshLeadStart =
  | { kind: 'started'; lead: HostTerminalOpenRequest | null }
  | { kind: 'failed'; reason: string }

/** The host's idempotency key shape (agent-session-host-authority): ms time, dash, 32 hex. */
export function freshLeadOperationIdOf(now: number, random: () => number): string {
  let nonce = ''
  while (nonce.length < 32) {
    nonce += Math.floor(random() * 0x1_0000_0000)
      .toString(16)
      .padStart(8, '0')
  }
  return `${now}-${nonce.slice(0, 32)}`
}

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

/** Opens the lead's Agent Teams session on the host, as the desktop's Start fresh lead does. */
export async function startFreshLeadFromPhone(
  client: RpcClient,
  args: { worktreeId: string; accountId: string | null; operationId: string }
): Promise<FreshLeadStart> {
  try {
    const response = await client.sendRequest(
      'terminal.createAgentSession',
      {
        clientOperationId: args.operationId,
        worktree: `id:${args.worktreeId}`,
        agent: 'claude-agent-teams',
        prompt: FRESH_LEAD_PROMPT,
        ...(args.accountId ? { claudeAccountId: args.accountId } : {})
      },
      { timeoutMs: CREATE_TIMEOUT_MS }
    )
    if (!response.ok) {
      return { kind: 'failed', reason: response.error.message }
    }
    const terminal = (response.result as { terminal?: Record<string, unknown> } | null)?.terminal
    const handle = textOf(terminal?.handle)
    const tabId = textOf(terminal?.tabId)
    const worktreeId = textOf(terminal?.worktreeId) ?? args.worktreeId
    return {
      kind: 'started',
      lead: handle && tabId ? { worktreeId, terminal: handle, tabId } : null
    }
  } catch (error) {
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) }
  }
}
