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
    const { client, sendRequest } = clientAnswering({ 'game.leads': ok(leadIn('repo-a::/w/main')) })

    await expect(read(client)).resolves.toEqual({
      kind: 'lead-live',
      lead: { worktreeId: 'repo-a::/w/main', terminal: 'term_lead', tabId: 'tab-lead' },
      roster: null
    })
    expect(sendRequest).not.toHaveBeenCalledWith('game.leadStored', expect.anything())
  })

  it("reads the lead's To Do and hosts for Add member", async () => {
    const { client, sendRequest } = clientAnswering({
      'game.leads': ok(leadIn('repo-a::/w/main')),
      'game.state': ok({
        role: 'lead',
        agents: [{ paneKey: 'p-lead', isLeader: true, isMember: false, state: 'idle' }],
        lead: { autostart: false, cap: 4, agent: 'claude' },
        project: {
          todo: { items: [{ id: 'ORCA-2', title: 'T', url: 'u', group: 'todo', prompt: 'P' }] }
        }
      })
    })

    const team = await read(client)

    expect(team.kind === 'lead-live' && team.roster).toEqual({
      todo: [{ identifier: 'ORCA-2', title: 'T', prompt: 'P' }],
      hosts: [{ on: null, running: 0, cap: 4 }]
    })
    expect(sendRequest).toHaveBeenCalledWith('game.state', {
      worktreeId: 'repo-a::/w/main',
      terminalHandle: 'term_lead',
      paneKey: `tab-lead:${LEAF}`
    })
  })

  it("reads a kept lead with its account's email when no lead of this project is live", async () => {
    const { client, sendRequest } = clientAnswering({
      'game.leads': ok(leadIn('repo-b::/w/main')),
      'game.leadStored': ok({ stored: { accountId: 'acct-2' } }),
      'accounts.list': ok({
        claude: { accounts: [{ id: 'acct-2', email: 'maya@acme.dev' }], activeAccountId: null }
      })
    })

    await expect(read(client)).resolves.toEqual({
      kind: 'lead-closed',
      accountEmail: 'maya@acme.dev'
    })
    expect(sendRequest).toHaveBeenCalledWith('game.leadStored', {
      worktreeId: 'repo-a::/w/feature'
    })
  })

  it('keeps Reopen when the kept lead ran on the default login or the accounts read fails', async () => {
    const onDefault = clientAnswering({
      'game.leads': ok({ leads: [], restoring: [] }),
      'game.leadStored': ok({ stored: { accountId: null } })
    })
    await expect(read(onDefault.client)).resolves.toEqual({
      kind: 'lead-closed',
      accountEmail: null
    })
    expect(onDefault.sendRequest).not.toHaveBeenCalledWith('accounts.list')

    const accountsDown = clientAnswering({
      'game.leads': ok({ leads: [], restoring: [] }),
      'game.leadStored': ok({ stored: { accountId: 'acct-2' } }),
      'accounts.list': new Error('timeout')
    })
    await expect(read(accountsDown.client)).resolves.toEqual({
      kind: 'lead-closed',
      accountEmail: null
    })
  })

  it('offers no second team while the host is still bringing a lead back', async () => {
    const { client } = clientAnswering({
      'game.leads': ok({ leads: [], restoring: [`tab-lead:${LEAF}`] })
    })

    await expect(read(client)).resolves.toEqual({ kind: 'pending' })
  })

  it('has no team when nothing is kept, and when both reads fail', async () => {
    const nothingKept = clientAnswering({
      'game.leads': ok({ leads: [], restoring: [] }),
      'game.leadStored': ok({ stored: null })
    })
    await expect(read(nothingKept.client)).resolves.toEqual({ kind: 'none' })

    const bothDown = clientAnswering({
      'game.leads': new Error('closed'),
      'game.leadStored': failure('forbidden')
    })
    await expect(read(bothDown.client)).resolves.toEqual({ kind: 'none' })
  })
})
