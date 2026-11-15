import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { reopenTeamLeadFromPhone } from './new-tab-team-reopen'

const ok = (result: unknown): RpcResponse =>
  ({ id: 'x', ok: true, result, _meta: { runtimeId: 'rt' } }) as RpcResponse
const failure = (code: string, message = code): RpcResponse =>
  ({ id: 'x', ok: false, error: { code, message }, _meta: { runtimeId: 'rt' } }) as RpcResponse

function clientReplying(answer: RpcResponse | Error) {
  const sendRequest = vi.fn(async () => {
    if (answer instanceof Error) {
      throw answer
    }
    return answer
  })
  return { client: { sendRequest } as unknown as RpcClient, sendRequest }
}

const reopen = (client: RpcClient) =>
  reopenTeamLeadFromPhone(client, { worktreeId: 'repo-a::/w/main', project: 'acme-web' })

describe('reopenTeamLeadFromPhone', () => {
  it("asks the host to reopen the project's kept lead, waiting out a restore", async () => {
    const { client, sendRequest } = clientReplying(ok({ resumed: { handle: 'term_lead' } }))

    await expect(reopen(client)).resolves.toEqual({ kind: 'lead' })
    expect(sendRequest).toHaveBeenCalledWith(
      'game.leadReopen',
      { worktreeId: 'repo-a::/w/main', project: 'acme-web', label: '' },
      { timeoutMs: 45_000 }
    )
  })

  it('takes a lead that was already live as reopened', async () => {
    await expect(
      reopen(clientReplying(ok({ live: { handle: 'term_lead' } })).client)
    ).resolves.toEqual({ kind: 'lead' })
  })

  it("reports the host's resume error, and nothing kept", async () => {
    await expect(
      reopen(clientReplying(ok({ registered: false, resumeError: 'no session' })).client)
    ).resolves.toEqual({ kind: 'failed', reason: 'no session' })
    await expect(reopen(clientReplying(ok({ registered: false })).client)).resolves.toEqual({
      kind: 'nothing-kept'
    })
  })

  it('reads a refusal from an older host as unsupported', async () => {
    for (const code of ['forbidden', 'method_not_found']) {
      await expect(reopen(clientReplying(failure(code)).client)).resolves.toEqual({
        kind: 'unsupported'
      })
    }
  })

  it('reports any other failure with its message', async () => {
    await expect(reopen(clientReplying(failure('internal', 'pty gone')).client)).resolves.toEqual({
      kind: 'failed',
      reason: 'pty gone'
    })
    await expect(reopen(clientReplying(new Error('timeout')).client)).resolves.toEqual({
      kind: 'failed',
      reason: 'timeout'
    })
  })
})
