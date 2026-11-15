import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentTeamsClientSettingsOf } from '../../../src/shared/agent-teams-client-settings'
import { settingsGetResultOf } from '../../../src/shared/settings-get-result'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { useAgentTeamsSettings } from './use-agent-teams-settings'

const ok = (result: unknown): RpcResponse =>
  ({ id: 'x', ok: true, result, _meta: { runtimeId: 'rt' } }) as RpcResponse
const refused = (message: string): RpcResponse =>
  ({
    id: 'x',
    ok: false,
    error: { code: 'invalid_params', message },
    _meta: { runtimeId: 'rt' }
  }) as RpcResponse

// Why built from the host's own functions: a change to settings.get's shape fails these tests.
const SETTINGS = settingsGetResultOf(
  agentTeamsClientSettingsOf({
    orchestratorGame: { scene: 'quest', panel: { style: 'figures' } },
    statusColors: { dark: { idle: '#abcdef' } }
  })
)

type Hook = ReturnType<typeof useAgentTeamsSettings>

describe('useAgentTeamsSettings', () => {
  const mounted: { renderer?: ReactTestRenderer } = {}
  afterEach(() => {
    act(() => mounted.renderer?.unmount())
    mounted.renderer = undefined
  })

  async function setup(args: { capabilities: string[]; update?: RpcResponse }) {
    const sendRequest = vi.fn(async (method: string) => {
      if (method === 'status.get') {
        return ok({ capabilities: args.capabilities })
      }
      if (method === 'settings.get') {
        return ok(SETTINGS)
      }
      return args.update ?? ok({})
    })
    const client = { sendRequest } as unknown as RpcClient
    const seen: Hook[] = []
    function Probe() {
      seen.push(useAgentTeamsSettings({ client, connected: true }))
      return null
    }
    await act(async () => {
      mounted.renderer = create(createElement(Probe))
    })
    return { sendRequest, hook: () => seen.at(-1)! }
  }

  it('asks an older host nothing and says it needs an update', async () => {
    const { hook, sendRequest } = await setup({ capabilities: [] })

    expect(hook().state).toEqual({ kind: 'unsupported' })
    expect(sendRequest).not.toHaveBeenCalledWith('settings.get')
  })

  it("reads the host's Agent Teams settings once the capability is there", async () => {
    const { hook } = await setup({ capabilities: ['mobile.agent-teams-settings.v1'] })

    expect(hook().state).toEqual({
      kind: 'ready',
      settings: { scene: 'quest', style: 'figures', dark: { idle: '#abcdef' } },
      saveError: null
    })
  })

  it('writes the scene, the style and a role colour through settings.update', async () => {
    const { hook, sendRequest } = await setup({ capabilities: ['mobile.agent-teams-settings.v1'] })

    await act(async () => hook().setScene('jrpg'))
    await act(async () => hook().setStyle('office'))
    await act(async () => hook().setToneColor('info', '#123456'))

    expect(sendRequest).toHaveBeenCalledWith('settings.update', {
      agentTeamsPanel: { scene: 'jrpg' }
    })
    expect(sendRequest).toHaveBeenCalledWith('settings.update', {
      agentTeamsPanel: { style: 'office' }
    })
    expect(sendRequest).toHaveBeenCalledWith('settings.update', {
      statusColors: { dark: { idle: '#abcdef', info: '#123456' } }
    })
    expect(hook().state).toMatchObject({
      settings: { scene: 'jrpg', style: 'office', dark: { idle: '#abcdef', info: '#123456' } }
    })
  })

  it('resets every role to the defaults', async () => {
    const { hook, sendRequest } = await setup({ capabilities: ['mobile.agent-teams-settings.v1'] })
    await act(async () => hook().setToneColor('info', '#123456'))

    await act(async () => hook().resetColors())

    expect(sendRequest).toHaveBeenLastCalledWith('settings.update', {
      statusColors: { dark: null }
    })
    expect(hook().state).toMatchObject({ settings: { dark: {} } })
  })

  it('puts the value back and says why when the host refuses the save', async () => {
    const { hook } = await setup({
      capabilities: ['mobile.agent-teams-settings.v1'],
      update: refused('Expected a #rrggbb colour')
    })

    await act(async () => hook().setToneColor('info', '#123456'))

    expect(hook().state).toEqual({
      kind: 'ready',
      settings: { scene: 'quest', style: 'figures', dark: { idle: '#abcdef' } },
      saveError: 'Could not save: Expected a #rrggbb colour'
    })
  })
})
