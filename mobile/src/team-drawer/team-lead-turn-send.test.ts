import { describe, expect, it, vi } from 'vitest'
import type { RpcClient, RpcResponse } from '../transport/rpc-client'
import { createTeamLeadTurnSender } from './team-lead-turn-send'

const reply = (accepted: boolean): RpcResponse =>
  ({ id: 'x', ok: true, result: { send: { accepted } }, _meta: { runtimeId: 'rt' } }) as RpcResponse

describe('the Team sheet lead turn', () => {
  it("sends the action to the lead's terminal as an agent prompt, as the desktop dock does", async () => {
    const sendRequest = vi.fn(async () => reply(true))
    const send = createTeamLeadTurnSender(() => 0)
    const client = { sendRequest } as unknown as RpcClient
    await expect(send(client, 'term_lead', 'lead:wave', '/orca-game:wave')).resolves.toBe('sent')
    expect(sendRequest).toHaveBeenCalledWith('terminal.send', {
      terminal: 'term_lead',
      text: '/orca-game:wave',
      enter: true,
      agentPrompt: true
    })
  })

  it('sends a second press inside 3 s only once', async () => {
    let now = 0
    const sendRequest = vi.fn(async () => reply(true))
    const send = createTeamLeadTurnSender(() => now)
    const client = { sendRequest } as unknown as RpcClient
    await send(client, 't', 'lead:wave', '/wave')
    now = 2_000
    await expect(send(client, 't', 'lead:wave', '/wave')).resolves.toBe('repeat')
    now = 3_500
    await expect(send(client, 't', 'lead:wave', '/wave')).resolves.toBe('sent')
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it('reports a refused or locked send as failed, and lets the next press through', async () => {
    const send = createTeamLeadTurnSender(() => 0)
    const locked = { sendRequest: vi.fn(async () => reply(false)) } as unknown as RpcClient
    await expect(send(locked, 't', 'lead:sweep', '/sweep')).resolves.toBe('failed')
    const refused = {
      sendRequest: vi.fn(async () => ({
        id: 'x',
        ok: false,
        error: { code: 'forbidden', message: 'no' },
        _meta: { runtimeId: 'rt' }
      }))
    } as unknown as RpcClient
    await expect(send(refused, 't', 'lead:sweep', '/sweep')).resolves.toBe('failed')
  })
})
