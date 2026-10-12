import { describe, expect, it, vi } from 'vitest'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import type { RpcResponse } from '../transport/types'
import { PluginPanelSession, type PluginPanelSessionState } from './plugin-panel-session'

const TOKEN_A = 'a'.repeat(43)
const TOKEN_B = 'b'.repeat(43)
const META = { runtimeId: 'r' }

function ok(result: unknown): RpcResponse {
  return { id: '1', ok: true, result, _meta: META }
}

function fail(message: string): RpcResponse {
  return { id: '1', ok: false, error: { code: 'runtime_error', message }, _meta: META }
}

function setup(responses: Record<string, (params: unknown) => Promise<RpcResponse>>) {
  const sendRequest = vi.fn((method: string, params?: unknown) => {
    const handler = responses[method]
    return handler ? handler(params) : Promise.resolve(fail(`unexpected ${method}`))
  })
  const states: PluginPanelSessionState[] = []
  const onDeliveryUnknown = vi.fn()
  const session = new PluginPanelSession({
    client: { sendRequest },
    pluginKey: 'demo.inbox',
    panelId: 'board',
    onState: (state) => states.push(state),
    onDeliveryUnknown
  })
  const calls = (method: string) => sendRequest.mock.calls.filter(([name]) => name === method)
  return { session, sendRequest, states, calls, onDeliveryUnknown }
}

const entry = (html: string, sessionToken: string) => () =>
  Promise.resolve(ok({ html, sessionToken }))

describe('PluginPanelSession', () => {
  it('opens the panel when connected in the foreground and holds its session', async () => {
    const { session, states, calls } = setup({
      'plugins.readPanelEntry': entry('<p>a</p>', TOKEN_A)
    })

    session.setConditions({ connected: true, foreground: true })

    await vi.waitFor(() => expect(session.getSessionToken()).toBe(TOKEN_A))
    expect(calls('plugins.readPanelEntry')[0]![1]).toEqual({
      pluginKey: 'demo.inbox',
      panelId: 'board'
    })
    expect(states.at(-1)).toEqual({ status: 'ready', html: '<p>a</p>', documentRevision: 1 })
  })

  it('releases the session when the app goes to the background and rotates it on return', async () => {
    let token = TOKEN_A
    const { session, states, calls } = setup({
      'plugins.readPanelEntry': () =>
        Promise.resolve(ok({ html: '<p>a</p>', sessionToken: token })),
      'plugins.releasePanel': () => Promise.resolve(ok({ released: true }))
    })
    session.setConditions({ connected: true, foreground: true })
    await vi.waitFor(() => expect(session.getSessionToken()).toBe(TOKEN_A))

    session.setConditions({ connected: true, foreground: false })

    expect(session.getSessionToken()).toBeNull()
    expect(calls('plugins.releasePanel')[0]![1]).toEqual({ sessionToken: TOKEN_A })

    token = TOKEN_B
    session.setConditions({ connected: true, foreground: true })
    await vi.waitFor(() => expect(session.getSessionToken()).toBe(TOKEN_B))
    // Same document: the panel keeps its state, only its authority rotates.
    expect(states.filter((state) => state.status === 'ready')).toHaveLength(1)
  })

  it('drops the session on disconnect without an RPC and re-opens on reconnect', async () => {
    let token = TOKEN_A
    const { session, calls } = setup({
      'plugins.readPanelEntry': () => Promise.resolve(ok({ html: '<p>a</p>', sessionToken: token }))
    })
    session.setConditions({ connected: true, foreground: true })
    await vi.waitFor(() => expect(session.getSessionToken()).toBe(TOKEN_A))

    session.setConditions({ connected: false, foreground: true })
    expect(session.getSessionToken()).toBeNull()
    expect(calls('plugins.releasePanel')).toEqual([])

    token = TOKEN_B
    session.setConditions({ connected: true, foreground: true })
    await vi.waitFor(() => expect(session.getSessionToken()).toBe(TOKEN_B))
  })

  it('bumps the document revision only when the host serves a different document', async () => {
    let html = '<p>a</p>'
    const { session, states } = setup({
      'plugins.readPanelEntry': () => Promise.resolve(ok({ html, sessionToken: TOKEN_A }))
    })
    session.setConditions({ connected: true, foreground: true })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('ready'))

    html = '<p>b</p>'
    session.setConditions({ connected: false, foreground: true })
    session.setConditions({ connected: true, foreground: true })

    await vi.waitFor(() =>
      expect(states.at(-1)).toEqual({ status: 'ready', html: '<p>b</p>', documentRevision: 2 })
    )
  })

  it('reports a panel the host no longer serves as unavailable', async () => {
    const { session, states } = setup({ 'plugins.readPanelEntry': () => Promise.resolve(ok(null)) })

    session.setConditions({ connected: true, foreground: true })

    await vi.waitFor(() => expect(states.at(-1)).toEqual({ status: 'unavailable' }))
    expect(session.getSessionToken()).toBeNull()
  })

  it('releases a session that arrives after the app already left the foreground', async () => {
    let resolve: (response: RpcResponse) => void = () => {}
    const { session, calls } = setup({
      'plugins.readPanelEntry': () => new Promise((done) => (resolve = done)),
      'plugins.releasePanel': () => Promise.resolve(ok({ released: true }))
    })
    session.setConditions({ connected: true, foreground: true })
    session.setConditions({ connected: true, foreground: false })

    resolve(ok({ html: '<p>a</p>', sessionToken: TOKEN_A }))

    await vi.waitFor(() => expect(calls('plugins.releasePanel')).toHaveLength(1))
    expect(session.getSessionToken()).toBeNull()
  })

  it('relays an action exactly once and returns the host outcome', async () => {
    const { session, calls } = setup({
      'plugins.readPanelEntry': entry('<p>a</p>', TOKEN_A),
      'plugins.panelAction': () => Promise.resolve(ok({ outcome: { ok: true, value: 3 } }))
    })

    await expect(
      session.callPanelAction({ sessionToken: TOKEN_A, action: 'storage.get', params: {} })
    ).resolves.toEqual({ ok: true, value: 3 })
    expect(calls('plugins.panelAction')).toHaveLength(1)
    expect(calls('plugins.panelAction')[0]![2]).toMatchObject({ failWhenDisconnected: true })
  })

  it('never resends an action whose delivery is unknown, and says so', async () => {
    const { session, calls, onDeliveryUnknown } = setup({
      'plugins.panelAction': () =>
        Promise.reject(markRpcDeliveryUnknown(new Error('Connection closed')))
    })

    const outcome = await session.callPanelAction({
      sessionToken: TOKEN_A,
      action: 'storage.set',
      params: { key: 'k', value: 1 }
    })

    expect(outcome).toMatchObject({ ok: false, code: 'unavailable' })
    expect(outcome.ok ? '' : outcome.error).toMatch(/may have been applied/)
    expect(onDeliveryUnknown).toHaveBeenCalledWith('storage.set')
    expect(calls('plugins.panelAction')).toHaveLength(1)
  })

  it('maps a send that never left the phone to unavailable without a delivery warning', async () => {
    const { session, onDeliveryUnknown } = setup({
      'plugins.panelAction': () => Promise.reject(new Error('Not connected'))
    })

    await expect(
      session.callPanelAction({ sessionToken: TOKEN_A, action: 'storage.get' })
    ).resolves.toMatchObject({ ok: false, code: 'unavailable' })
    expect(onDeliveryUnknown).not.toHaveBeenCalled()
  })

  it('maps an RPC error and a malformed answer to failures the panel can show', async () => {
    const { session } = setup({
      'plugins.panelAction': () => Promise.resolve(fail('Method not allowed'))
    })
    await expect(
      session.callPanelAction({ sessionToken: TOKEN_A, action: 'storage.get' })
    ).resolves.toEqual({ ok: false, code: 'unavailable', error: 'Method not allowed' })

    const malformed = setup({ 'plugins.panelAction': () => Promise.resolve(ok({ nope: 1 })) })
    await expect(
      malformed.session.callPanelAction({ sessionToken: TOKEN_A, action: 'storage.get' })
    ).resolves.toMatchObject({ ok: false, code: 'action_failed' })
  })

  it('releases its session on dispose and ignores late answers', async () => {
    const { session, calls, states } = setup({
      'plugins.readPanelEntry': entry('<p>a</p>', TOKEN_A),
      'plugins.releasePanel': () => Promise.resolve(ok({ released: true }))
    })
    session.setConditions({ connected: true, foreground: true })
    await vi.waitFor(() => expect(session.getSessionToken()).toBe(TOKEN_A))
    const before = states.length

    session.dispose()
    session.setConditions({ connected: true, foreground: true })

    expect(calls('plugins.releasePanel')[0]![1]).toEqual({ sessionToken: TOKEN_A })
    expect(calls('plugins.readPanelEntry')).toHaveLength(1)
    expect(states).toHaveLength(before)
  })

  it('recovers to the panel when a retry after a failed re-open serves the same document', async () => {
    let reads = 0
    const { session, states } = setup({
      'plugins.readPanelEntry': () => {
        reads += 1
        return reads === 2
          ? Promise.resolve(fail('host busy'))
          : Promise.resolve(ok({ html: '<p>a</p>', sessionToken: TOKEN_A }))
      }
    })
    session.setConditions({ connected: true, foreground: true })
    await vi.waitFor(() => expect(session.getSessionToken()).toBe(TOKEN_A))
    session.setConditions({ connected: false, foreground: true })
    session.setConditions({ connected: true, foreground: true })
    await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ status: 'error' }))

    session.retry()

    await vi.waitFor(() =>
      expect(states.at(-1)).toEqual({ status: 'ready', html: '<p>a</p>', documentRevision: 2 })
    )
  })

  it('releases the session it already holds when a retry replaces it', async () => {
    let reads = 0
    const { session, calls } = setup({
      'plugins.readPanelEntry': () => {
        reads += 1
        return Promise.resolve(
          ok({ html: '<p>a</p>', sessionToken: reads === 1 ? TOKEN_A : TOKEN_B })
        )
      },
      'plugins.releasePanel': () => Promise.resolve(ok({ released: true }))
    })
    session.setConditions({ connected: true, foreground: true })
    await vi.waitFor(() => expect(session.getSessionToken()).toBe(TOKEN_A))

    session.retry()

    await vi.waitFor(() => expect(session.getSessionToken()).toBe(TOKEN_B))
    expect(calls('plugins.releasePanel').map(([, params]) => params)).toEqual([
      { sessionToken: TOKEN_A }
    ])
  })
})
