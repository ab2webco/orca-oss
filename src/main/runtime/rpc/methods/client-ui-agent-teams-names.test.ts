import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { CLIENT_UI_METHODS } from './client-ui'

function makeRequest(params: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method: 'settings.update', params }
}

function dispatcherWith(): { dispatcher: RpcDispatcher; runtime: OrcaRuntimeService } {
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    updateClientSettings: vi.fn(() => ({}))
  } as unknown as OrcaRuntimeService
  return { dispatcher: new RpcDispatcher({ runtime, methods: CLIENT_UI_METHODS }), runtime }
}

describe('settings.update agentTeamsNames', () => {
  it('passes the lead name, trimmed, and the member names to the runtime', async () => {
    const { dispatcher, runtime } = dispatcherWith()

    const response = await dispatcher.dispatch(
      makeRequest({ agentTeamsNames: { leadName: ' Ada ', memberNames: ['Bo', 'Cy'] } })
    )

    expect(response).toMatchObject({ ok: true })
    expect(runtime.updateClientSettings).toHaveBeenCalledWith({
      agentTeamsNames: { leadName: 'Ada', memberNames: ['Bo', 'Cy'] }
    })
  })

  it('passes null, which clears a name', async () => {
    const { dispatcher, runtime } = dispatcherWith()

    await dispatcher.dispatch(
      makeRequest({ agentTeamsNames: { leadName: null, memberNames: null } })
    )

    expect(runtime.updateClientSettings).toHaveBeenCalledWith({
      agentTeamsNames: { leadName: null, memberNames: null }
    })
  })

  it.each([
    ['an empty lead name', { leadName: '  ' }],
    ['a lead name over 32 characters', { leadName: 'x'.repeat(33) }],
    ['an empty member list', { memberNames: [] }],
    ['a member listed twice', { memberNames: ['Bo', 'bo'] }],
    ['a member name that reads as a ticket id', { memberNames: ['ORCA-12'] }],
    ['an unknown key', { scene: 'quest' }]
  ])('rejects %s without touching Settings', async (_name, names) => {
    const { dispatcher, runtime } = dispatcherWith()

    const response = await dispatcher.dispatch(makeRequest({ agentTeamsNames: names }))

    expect(response).toMatchObject({ ok: false })
    expect(runtime.updateClientSettings).not.toHaveBeenCalled()
  })
})
