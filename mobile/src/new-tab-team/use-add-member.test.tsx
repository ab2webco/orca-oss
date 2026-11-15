import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { useAddMember } from './use-add-member'

vi.mock('../platform/haptics', () => ({ triggerError: vi.fn(), triggerSuccess: vi.fn() }))

const ok = (result: unknown): RpcResponse =>
  ({ id: 'x', ok: true, result, _meta: { runtimeId: 'rt' } }) as RpcResponse
const roster = {
  todo: [{ identifier: 'ORCA-7', title: 'T', prompt: 'P' }],
  hosts: [{ on: null, running: 0, cap: 4 }]
}
type Hook = ReturnType<typeof useAddMember>

describe('useAddMember', () => {
  const mounted: { renderer?: ReactTestRenderer } = {}
  afterEach(() => {
    act(() => mounted.renderer?.unmount())
    mounted.renderer = undefined
  })

  async function setup(accepted: boolean) {
    const sendRequest = vi.fn(async () => ok({ send: { accepted } }))
    const client = { sendRequest } as unknown as RpcClient
    const showToast = vi.fn()
    const seen: Hook[] = []
    function Probe() {
      seen.push(useAddMember({ client, showToast }))
      return null
    }
    await act(async () => {
      mounted.renderer = create(createElement(Probe))
    })
    await act(async () => seen.at(-1)!.start(roster, 'term_lead'))
    return { sendRequest, showToast, hook: () => seen.at(-1)! }
  }

  it("opens on the lead's roster", async () => {
    const { hook } = await setup(true)

    expect(hook().sheet).toMatchObject({ visible: true, roster })
  })

  it('sends the lead the ticket, then confirms and closes', async () => {
    const { hook, sendRequest, showToast } = await setup(true)

    await act(async () =>
      hook().sheet!.onSend({ ticket: roster.todo[0], accountId: 'a-1', on: null })
    )

    expect(sendRequest).toHaveBeenCalledWith(
      'terminal.send',
      expect.objectContaining({ terminal: 'term_lead' })
    )
    expect(showToast).toHaveBeenCalledWith('Sent to the lead: ORCA-7')
    expect(hook().sheet?.visible).toBe(false)
  })

  it('keeps the sheet open and says so when the lead refuses the turn', async () => {
    const { hook, showToast } = await setup(false)

    const ticket = { identifier: 'ORCA-8', title: 'T', prompt: 'P' }
    await act(async () => hook().sheet!.onSend({ ticket, accountId: null, on: null }))

    expect(showToast).toHaveBeenCalledWith('Could not send ORCA-8', 2400)
    expect(hook().sheet?.visible).toBe(true)
  })
})
