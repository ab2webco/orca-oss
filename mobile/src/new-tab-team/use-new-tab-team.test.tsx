import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import type { NewTabTeam } from './new-tab-team-read'
import { useNewTabTeam } from './use-new-tab-team'

const ok = (result: unknown): RpcResponse =>
  ({ id: 'x', ok: true, result, _meta: { runtimeId: 'rt' } }) as RpcResponse

const LEAD = {
  handle: 'term_lead',
  worktreeId: 'r::/w',
  paneKey: 'tab-lead:11111111-1111-4111-8111-111111111111'
}
const sendRequest = vi.fn(async () => ok({ leads: [LEAD], restoring: [] }))
const client = { sendRequest } as unknown as RpcClient

type Args = Parameters<typeof useNewTabTeam>[0]

function Probe(props: Args & { seen: NewTabTeam[] }) {
  props.seen.push(useNewTabTeam(props))
  return null
}

describe('useNewTabTeam', () => {
  const mounted: { renderer?: ReactTestRenderer } = {}
  afterEach(() => {
    act(() => mounted.renderer?.unmount())
    mounted.renderer = undefined
    sendRequest.mockClear()
  })

  async function render(args: Partial<Args>): Promise<NewTabTeam[]> {
    const seen: NewTabTeam[] = []
    const props = {
      client,
      connected: true,
      open: true,
      supported: true,
      worktreeId: 'r::/w',
      ...args
    }
    await act(async () => {
      mounted.renderer = create(createElement(Probe, { ...props, seen }))
    })
    return seen
  }

  it('reads the team when the sheet opens', async () => {
    const seen = await render({})

    expect(seen.at(-1)).toEqual({
      kind: 'lead-live',
      lead: { worktreeId: 'r::/w', terminal: 'term_lead', tabId: 'tab-lead' }
    })
  })

  it('holds the group while the capability probe has not answered, and reads nothing closed', async () => {
    expect((await render({ supported: null })).at(-1)).toEqual({ kind: 'pending' })
    act(() => mounted.renderer?.unmount())
    expect((await render({ open: false })).at(-1)).toEqual({ kind: 'pending' })
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it("keeps today's sheet while the desktop is not connected", async () => {
    expect((await render({ connected: false })).at(-1)).toEqual({ kind: 'none' })
    expect(sendRequest).not.toHaveBeenCalled()
  })
})
