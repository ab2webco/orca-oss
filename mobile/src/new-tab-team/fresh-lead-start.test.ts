import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { freshLeadOperationIdOf, startFreshLeadFromPhone } from './fresh-lead-start'

const ok = (result: unknown): RpcResponse =>
  ({ id: 'x', ok: true, result, _meta: { runtimeId: 'rt' } }) as RpcResponse
const failure = (message: string): RpcResponse =>
  ({
    id: 'x',
    ok: false,
    error: { code: 'internal', message },
    _meta: { runtimeId: 'rt' }
  }) as RpcResponse

function clientAnswering(answer: RpcResponse | Error) {
  const sendRequest = vi.fn(async () => {
    if (answer instanceof Error) {
      throw answer
    }
    return answer
  })
  return { client: { sendRequest } as unknown as RpcClient, sendRequest }
}

const CREATED = ok({
  terminal: { handle: 'term_new', tabId: 'tab-new', worktreeId: 'repo-a::/w/main' },
  disposition: 'created'
})
const start = (client: RpcClient, accountId: string | null) =>
  startFreshLeadFromPhone(client, {
    worktreeId: 'repo-a::/w/main',
    accountId,
    operationId: '1763164800000-0123456789abcdef0123456789abcdef'
  })

describe('startFreshLeadFromPhone', () => {
  it("opens an Agent Teams session with the fresh lead prompt on the chosen account (desktop's onStartFresh)", async () => {
    const { client, sendRequest } = clientAnswering(CREATED)

    await expect(start(client, 'acct-2')).resolves.toEqual({
      kind: 'started',
      lead: { worktreeId: 'repo-a::/w/main', terminal: 'term_new', tabId: 'tab-new' }
    })
    expect(sendRequest).toHaveBeenCalledWith(
      'terminal.createAgentSession',
      {
        clientOperationId: '1763164800000-0123456789abcdef0123456789abcdef',
        worktree: 'id:repo-a::/w/main',
        agent: 'claude-agent-teams',
        prompt: '/orca-game:lead fresh',
        claudeAccountId: 'acct-2'
      },
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
  })

  it("sends no account for the agent's own login", async () => {
    const { client, sendRequest } = clientAnswering(CREATED)

    await start(client, null)

    expect(sendRequest.mock.calls[0]).not.toContainEqual(
      expect.objectContaining({ claudeAccountId: expect.anything() })
    )
  })

  it("says why the host could not create the lead's session", async () => {
    const refused = clientAnswering(failure('agent_session_legacy_required'))
    await expect(start(refused.client, null)).resolves.toEqual({
      kind: 'failed',
      reason: 'agent_session_legacy_required'
    })

    const dropped = clientAnswering(new Error('Connection closed'))
    await expect(start(dropped.client, null)).resolves.toEqual({
      kind: 'failed',
      reason: 'Connection closed'
    })
  })

  it('still reports a lead the host started without a tab to show', async () => {
    const { client } = clientAnswering(
      ok({ terminal: { handle: 'term_new', worktreeId: 'w' }, disposition: 'created' })
    )

    await expect(start(client, null)).resolves.toEqual({ kind: 'started', lead: null })
  })
})

describe('freshLeadOperationIdOf', () => {
  // Why: the host rejects any other shape as agent_session_operation_invalid.
  it('builds the id the host accepts: 13-digit time, dash, 32 hex', () => {
    const id = freshLeadOperationIdOf(1763164800000, () => 0.5)

    expect(id).toMatch(/^1763164800000-[0-9a-f]{32}$/)
  })

  it('differs between presses', () => {
    expect(freshLeadOperationIdOf(1, Math.random)).not.toBe(freshLeadOperationIdOf(1, Math.random))
  })
})
