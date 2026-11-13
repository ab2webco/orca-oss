import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { CLIENT_UI_METHODS } from './client-ui'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

function dispatcherWith(): { dispatcher: RpcDispatcher; runtime: OrcaRuntimeService } {
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    updateClientSettings: vi.fn(() => ({}))
  } as unknown as OrcaRuntimeService
  return { dispatcher: new RpcDispatcher({ runtime, methods: CLIENT_UI_METHODS }), runtime }
}

describe('settings.update Agent Teams fields', () => {
  it('passes the scene, style and a theme palette to the runtime', async () => {
    const { dispatcher, runtime } = dispatcherWith()

    const response = await dispatcher.dispatch(
      makeRequest('settings.update', {
        agentTeamsPanel: { scene: ' jrpg ', style: 'figures' },
        statusColors: { dark: { success: '#3ddc97' } }
      })
    )

    expect(response).toMatchObject({ ok: true })
    expect(runtime.updateClientSettings).toHaveBeenCalledWith({
      agentTeamsPanel: { scene: 'jrpg', style: 'figures' },
      statusColors: { dark: { success: '#3ddc97' } }
    })
  })

  it('passes a null palette, which resets that theme', async () => {
    const { dispatcher, runtime } = dispatcherWith()

    await dispatcher.dispatch(makeRequest('settings.update', { statusColors: { dark: null } }))

    expect(runtime.updateClientSettings).toHaveBeenCalledWith({ statusColors: { dark: null } })
  })

  it.each([
    ['an unknown style', { agentTeamsPanel: { style: 'neon' } }],
    ['the look, which the phone does not set', { agentTeamsPanel: { look: 'plain' } }],
    ['an empty scene', { agentTeamsPanel: { scene: '  ' } }],
    ['a colour that is not #rrggbb', { statusColors: { dark: { success: 'green' } } }],
    ['an unknown tone', { statusColors: { dark: { danger: '#ff0000' } } }]
  ])('rejects %s without touching Settings', async (_name, params) => {
    const { dispatcher, runtime } = dispatcherWith()

    const response = await dispatcher.dispatch(makeRequest('settings.update', params))

    expect(response).toMatchObject({ ok: false })
    expect(runtime.updateClientSettings).not.toHaveBeenCalled()
  })
})
