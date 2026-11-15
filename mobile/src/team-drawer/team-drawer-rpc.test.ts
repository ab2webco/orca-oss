import { describe, expect, it, vi } from 'vitest'
import type { RpcClient, RpcResponse } from '../transport/rpc-client'
import { readLeadGameState, readLeadInboxThreads, readLeadXp } from './team-drawer-rpc'

const caller = { worktreeId: 'repo::/lead', terminalHandle: 'term_1', paneKey: 'tab-1:leaf' }

function clientReplying(response: RpcResponse) {
  const sendRequest = vi.fn(async () => response)
  return { client: { sendRequest } as unknown as RpcClient, sendRequest }
}

const failure = (code: string): RpcResponse =>
  ({
    id: 'x',
    ok: false,
    error: { code, message: code },
    _meta: { runtimeId: 'rt' }
  }) as RpcResponse

describe('readLeadGameState', () => {
  it("reads the lead pane's game state with its pane key, so members come back", async () => {
    const { client, sendRequest } = clientReplying({
      id: 'x',
      ok: true,
      result: { role: 'lead' },
      _meta: { runtimeId: 'rt' }
    } as RpcResponse)

    await expect(readLeadGameState(client, caller)).resolves.toEqual({
      status: 'ok',
      state: { role: 'lead' }
    })
    expect(sendRequest).toHaveBeenCalledWith('game.state', caller)
  })

  it('treats a host that predates the phone allowlist as having no Team', async () => {
    for (const code of ['forbidden', 'method_not_found']) {
      const { client } = clientReplying(failure(code))
      await expect(readLeadGameState(client, caller)).resolves.toEqual({ status: 'unavailable' })
    }
  })

  it('throws any other failure so the last Team stays on screen', async () => {
    const { client } = clientReplying(failure('internal_error'))
    await expect(readLeadGameState(client, caller)).rejects.toThrow('internal_error')
  })
})

describe('readLeadInboxThreads', () => {
  const lead = { worktreeId: 'repo::/lead', terminalHandle: 'term_1' }

  it("reads the lead's own Inbox threads and drops a malformed row", async () => {
    const { client, sendRequest } = clientReplying({
      id: 'x',
      ok: true,
      result: { threads: [{ ticket: 3 }], waiting: [], answered: [] },
      _meta: { runtimeId: 'rt' }
    } as RpcResponse)

    await expect(readLeadInboxThreads(client, lead)).resolves.toEqual({
      status: 'ok',
      threads: { threads: [], waiting: [], answered: [] }
    })
    expect(sendRequest).toHaveBeenCalledWith('game.inboxThreads', lead)
  })

  it('treats a host whose phone allowlist predates the Inbox tab as unavailable', async () => {
    for (const code of ['forbidden', 'method_not_found']) {
      const { client } = clientReplying(failure(code))
      await expect(readLeadInboxThreads(client, lead)).resolves.toEqual({ status: 'unavailable' })
    }
  })
})

describe('readLeadXp', () => {
  const lead = { worktreeId: 'repo::/lead', terminalHandle: 'term_1' }

  it("sums the project's characters XP as the desktop does, skipping bad values", async () => {
    const { client, sendRequest } = clientReplying({
      id: 'x',
      ok: true,
      result: { characters: [{ xp: 150 }, { xp: 90 }, { xp: -5 }, { xp: 'x' }, null] },
      _meta: { runtimeId: 'rt' }
    } as RpcResponse)
    await expect(readLeadXp(client, lead)).resolves.toBe(240)
    expect(sendRequest).toHaveBeenCalledWith('game.characters', lead)
  })

  it('reads no XP from a host that refuses or sends no list', async () => {
    for (const code of ['forbidden', 'method_not_found', 'internal']) {
      const { client } = clientReplying(failure(code))
      await expect(readLeadXp(client, lead)).resolves.toBeNull()
    }
    const { client } = clientReplying({
      id: 'x',
      ok: true,
      result: {},
      _meta: { runtimeId: 'rt' }
    } as RpcResponse)
    await expect(readLeadXp(client, lead)).resolves.toBeNull()
  })
})
