import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { readNewTabTeam } from './new-tab-team-read'

const LEAF = '11111111-1111-4111-8111-111111111111'
const ok = (result: unknown): RpcResponse =>
  ({ id: 'x', ok: true, result, _meta: { runtimeId: 'rt' } }) as RpcResponse
const failure = (code: string): RpcResponse =>
  ({
    id: 'x',
    ok: false,
    error: { code, message: code },
    _meta: { runtimeId: 'rt' }
  }) as RpcResponse

function clientAnswering(answers: Record<string, RpcResponse | Error>) {
  const sendRequest = vi.fn(async (method: string) => {
    const answer = answers[method] ?? failure('method_not_found')
    if (answer instanceof Error) {
      throw answer
    }
    return answer
  })
  return { client: { sendRequest } as unknown as RpcClient, sendRequest }
}

const read = (client: RpcClient, supported = true) =>
  readNewTabTeam(client, { supported, worktreeId: 'repo-a::/w/feature' })

const leadIn = (worktreeId: string) => ({
  leads: [{ handle: 'term_lead', worktreeId, paneKey: `tab-lead:${LEAF}` }],
  restoring: []
})

describe('readNewTabTeam', () => {
  it('asks an older host nothing, so the sheet can show the update message', async () => {
    const { client, sendRequest } = clientAnswering({})

    await expect(read(client, false)).resolves.toEqual({ kind: 'unsupported' })
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it("finds the project's live lead in another worktree of the same repo", async () => {
    const { client } = clientAnswering({ 'game.leads': ok(leadIn('repo-a::/w/main')) })

    await expect(read(client)).resolves.toEqual({
      kind: 'lead-live',
      lead: { worktreeId: 'repo-a::/w/main', terminal: 'term_lead', tabId: 'tab-lead' }
    })
  })

  it('offers no second team while the host is still bringing a lead back', async () => {
    const { client } = clientAnswering({
      'game.leads': ok({ leads: [], restoring: [`tab-lead:${LEAF}`] })
    })

    await expect(read(client)).resolves.toEqual({ kind: 'pending' })
  })

  it('has no team when no lead of this project is live, and when the read fails', async () => {
    const otherProject = clientAnswering({ 'game.leads': ok(leadIn('repo-b::/w/main')) })
    await expect(read(otherProject.client)).resolves.toEqual({ kind: 'none' })

    const down = clientAnswering({ 'game.leads': new Error('closed') })
    await expect(read(down.client)).resolves.toEqual({ kind: 'none' })
  })
})
