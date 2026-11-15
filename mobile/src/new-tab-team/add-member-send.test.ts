import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { createAddMemberSender } from './add-member-send'

const TICKET = { identifier: 'ORCA-9', title: 'Fix it', prompt: 'Work on ORCA-9' }
const answer = (result: unknown, ok = true): RpcResponse =>
  (ok
    ? { id: 'x', ok: true, result, _meta: { runtimeId: 'rt' } }
    : {
        id: 'x',
        ok: false,
        error: { code: 'internal', message: 'x' },
        _meta: { runtimeId: 'rt' }
      }) as RpcResponse

function setup(response: RpcResponse) {
  let now = 1000
  const sendRequest = vi.fn(async () => response)
  const send = createAddMemberSender(() => now)
  return {
    client: { sendRequest } as unknown as RpcClient,
    sendRequest,
    send,
    advance: (ms: number) => (now += ms)
  }
}

const args = { terminal: 'term_lead', ticket: TICKET, accountId: 'acct-2', on: 'imac' }

describe('createAddMemberSender', () => {
  it('sends the lead the ticket prompt with its launch, account and host, as a submitted turn', async () => {
    const { client, sendRequest, send } = setup(answer({ send: { accepted: true } }))

    await expect(send(client, args)).resolves.toBe('sent')
    expect(sendRequest).toHaveBeenCalledWith('terminal.send', {
      terminal: 'term_lead',
      text: 'Work on ORCA-9\n\nLaunch its member with: orca game launch ORCA-9 --account acct-2 --on imac',
      enter: true
    })
  })

  it('takes a second tap on the same ticket within 3 s as the same launch', async () => {
    const { client, sendRequest, send, advance } = setup(answer({ send: { accepted: true } }))

    await send(client, args)
    advance(2999)

    await expect(send(client, args)).resolves.toBe('repeat')
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })

  it('reads a refused or locked write as failed', async () => {
    const refused = setup(answer(null, false))
    await expect(refused.send(refused.client, args)).resolves.toBe('failed')
    const locked = setup(answer({ send: { accepted: false } }))
    await expect(locked.send(locked.client, args)).resolves.toBe('failed')
  })
})
