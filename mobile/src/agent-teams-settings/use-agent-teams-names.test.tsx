import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentTeamsNamesOf } from '../../../src/shared/agent-teams-names-settings'
import { settingsGetResultOf } from '../../../src/shared/settings-get-result'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { useAgentTeamsNames } from './use-agent-teams-names'

const ok = (result: unknown): RpcResponse =>
  ({ id: 'x', ok: true, result, _meta: { runtimeId: 'rt' } }) as RpcResponse
const refused = (message: string): RpcResponse =>
  ({
    id: 'x',
    ok: false,
    error: { code: 'invalid_params', message },
    _meta: { runtimeId: 'rt' }
  }) as RpcResponse

// Why built from the host's own function: a change to settings.get's shape fails these tests.
const NAMES = settingsGetResultOf({
  agentTeamsNames: agentTeamsNamesOf({ orchestratorGame: { scene: 'quest' } })
})
// An older host: v1 settings, no agentTeamsNames in settings.get and a strict settings.update.
const OLD_HOST = settingsGetResultOf({ agentTeamsPanel: { scene: 'quest' } })

type Hook = ReturnType<typeof useAgentTeamsNames>

describe('useAgentTeamsNames', () => {
  const mounted: { renderer?: ReactTestRenderer } = {}
  afterEach(() => {
    act(() => mounted.renderer?.unmount())
    mounted.renderer = undefined
  })

  async function setup(args: { capabilities: string[]; get?: unknown; update?: RpcResponse }) {
    const sendRequest = vi.fn(async (method: string) => {
      if (method === 'status.get') {
        return ok({ capabilities: args.capabilities })
      }
      if (method === 'settings.get') {
        return ok(args.get ?? NAMES)
      }
      return args.update ?? ok({})
    })
    const client = { sendRequest } as unknown as RpcClient
    const seen: Hook[] = []
    function Probe() {
      seen.push(useAgentTeamsNames({ client, connected: true }))
      return null
    }
    await act(async () => {
      mounted.renderer = create(createElement(Probe))
    })
    return { sendRequest, hook: () => seen.at(-1)! }
  }

  it('never sends agentTeamsNames to an older host that has only the v1 settings', async () => {
    const { hook, sendRequest } = await setup({
      capabilities: ['mobile.agent-teams-settings.v1'],
      get: OLD_HOST,
      update: refused('Unrecognized key: "agentTeamsNames"')
    })

    await act(async () => hook().setLeadName('Ada'))

    expect(hook().state).toEqual({ kind: 'unsupported' })
    expect(sendRequest).not.toHaveBeenCalledWith('settings.get')
    expect(sendRequest).not.toHaveBeenCalledWith('settings.update', expect.anything())
  })

  it('falls back to unsupported when settings.get has no names, even with the capability', async () => {
    const { hook } = await setup({ capabilities: ['mobile.agent-teams-names.v1'], get: OLD_HOST })

    expect(hook().state).toEqual({ kind: 'unsupported' })
  })

  it('reads an unnamed lead and the scene roster once the capability is there', async () => {
    const { hook } = await setup({ capabilities: ['mobile.agent-teams-names.v1'] })

    expect(hook().state).toMatchObject({
      kind: 'ready',
      names: { leadName: null, memberNames: null },
      saveError: null
    })
  })

  it('writes the lead name and the member names, and clears them with null', async () => {
    const { hook, sendRequest } = await setup({ capabilities: ['mobile.agent-teams-names.v1'] })

    await act(async () => hook().setLeadName('Ada'))
    await act(async () => hook().setMemberNames(['Bo', 'Cy']))
    expect(hook().state).toMatchObject({ names: { leadName: 'Ada', memberNames: ['Bo', 'Cy'] } })
    await act(async () => hook().setLeadName(null))

    expect(sendRequest).toHaveBeenCalledWith('settings.update', {
      agentTeamsNames: { leadName: 'Ada' }
    })
    expect(sendRequest).toHaveBeenCalledWith('settings.update', {
      agentTeamsNames: { memberNames: ['Bo', 'Cy'] }
    })
    expect(sendRequest).toHaveBeenLastCalledWith('settings.update', {
      agentTeamsNames: { leadName: null }
    })
  })

  it('puts the name back and says why when the host refuses it', async () => {
    const { hook } = await setup({
      capabilities: ['mobile.agent-teams-names.v1'],
      update: refused('must be 1 to 32 characters')
    })

    await act(async () => hook().setLeadName('x'.repeat(40)))

    expect(hook().state).toMatchObject({
      names: { leadName: null },
      saveError: 'Could not save: must be 1 to 32 characters'
    })
  })
})
