import { describe, expect, it, vi } from 'vitest'
import {
  PANEL_ACTION_REQUEST_TYPE,
  PANEL_MESSAGE_MAX_BYTES,
  PANEL_MESSAGE_RATE_LIMIT,
  PANEL_PONG_TYPE
} from '../../../src/shared/plugins/plugin-panel-bridge'
import {
  PANEL_RESULT_MAX_BYTES,
  createPluginPanelHostRelay,
  type PluginPanelHostRelayOptions
} from './plugin-panel-host-relay'
import { PANEL_OUTER_DELIVER_GLOBAL, buildPanelDeliverScript } from './plugin-panel-outer-document'

const NONCE = 'n'.repeat(32)
const TOKEN = 't'.repeat(43)

function setup(overrides: Partial<PluginPanelHostRelayOptions> = {}) {
  const delivered: unknown[] = []
  const callPanelAction = vi.fn().mockResolvedValue({ ok: true, value: 'v' })
  const relay = createPluginPanelHostRelay({
    nonce: NONCE,
    getSessionToken: () => TOKEN,
    callPanelAction,
    deliver: (message) => delivered.push(message),
    isCurrent: () => true,
    ...overrides
  })
  return { relay, delivered, callPanelAction }
}

function frame(data: unknown, nonce = NONCE): string {
  return JSON.stringify({ nonce, kind: 'frame', payload: JSON.stringify(data) })
}

const request = {
  type: PANEL_ACTION_REQUEST_TYPE,
  requestId: 'r1',
  action: 'storage.get',
  params: { key: 'k' }
}

describe('createPluginPanelHostRelay', () => {
  it('relays a nonce-tagged frame to plugins.panelAction and delivers the result', async () => {
    const { relay, delivered, callPanelAction } = setup()

    relay.handleWebViewMessage(frame(request))

    await vi.waitFor(() => expect(delivered).toHaveLength(1))
    expect(callPanelAction).toHaveBeenCalledWith({
      sessionToken: TOKEN,
      action: 'storage.get',
      params: { key: 'k' }
    })
    expect(delivered[0]).toMatchObject({ requestId: 'r1', ok: true, value: 'v' })
  })

  it('drops frames without this load nonce, so a frame calling the native bridge directly gets nothing', async () => {
    const { relay, delivered, callPanelAction } = setup()

    relay.handleWebViewMessage(frame(request, 'x'.repeat(32)))
    relay.handleWebViewMessage(JSON.stringify(request))
    relay.handleWebViewMessage('not json')
    relay.handleWebViewMessage(JSON.stringify({ nonce: NONCE, kind: 'frame', payload: 42 }))

    await new Promise((done) => setTimeout(done, 0))
    expect(callPanelAction).not.toHaveBeenCalled()
    expect(delivered).toEqual([])
  })

  it('refuses a request over the 64 KB panel budget', () => {
    const { relay, delivered, callPanelAction } = setup()

    relay.handleWebViewMessage(
      frame({ ...request, params: { value: 'x'.repeat(PANEL_MESSAGE_MAX_BYTES) } })
    )

    expect(callPanelAction).not.toHaveBeenCalled()
    expect(delivered[0]).toMatchObject({ requestId: 'r1', ok: false, errorCode: 'invalid_request' })
  })

  it('answers a frame the outer page reported as oversized and charges it to the rate budget', () => {
    const { relay, delivered } = setup({ now: () => 0 })
    const oversized = JSON.stringify({
      nonce: NONCE,
      kind: 'oversized',
      payload: { requestId: 'big' }
    })

    relay.handleWebViewMessage(oversized)
    expect(delivered[0]).toMatchObject({
      requestId: 'big',
      ok: false,
      errorCode: 'invalid_request'
    })

    for (let i = 1; i < PANEL_MESSAGE_RATE_LIMIT.maxMessages; i++) {
      relay.handleWebViewMessage(oversized)
    }
    relay.handleWebViewMessage(frame(request))
    expect(delivered.at(-1)).toMatchObject({
      requestId: 'r1',
      ok: false,
      errorCode: 'rate_limited'
    })
  })

  it('caps results delivered back into the panel at the mobile result budget', async () => {
    const { relay, delivered } = setup({
      callPanelAction: vi
        .fn()
        .mockResolvedValue({ ok: true, value: 'x'.repeat(PANEL_RESULT_MAX_BYTES + 1) })
    })

    relay.handleWebViewMessage(frame(request))

    await vi.waitFor(() => expect(delivered).toHaveLength(1))
    expect(delivered[0]).toMatchObject({ ok: false, errorCode: 'action_failed' })
  })

  it('keeps delivering the large reads a real settings panel makes (about 90 KB)', async () => {
    const value = { scope: 'x'.repeat(90 * 1024) }
    const { relay, delivered } = setup({
      callPanelAction: vi.fn().mockResolvedValue({ ok: true, value })
    })

    relay.handleWebViewMessage(frame(request))

    await vi.waitFor(() => expect(delivered).toHaveLength(1))
    expect(delivered[0]).toMatchObject({ ok: true, value })
  })

  it('answers unavailable without reaching the host while no session is held', async () => {
    const { relay, delivered, callPanelAction } = setup({ getSessionToken: () => null })

    relay.handleWebViewMessage(frame(request))

    await vi.waitFor(() => expect(delivered).toHaveLength(1))
    expect(callPanelAction).not.toHaveBeenCalled()
    expect(delivered[0]).toMatchObject({ ok: false, errorCode: 'unavailable' })
  })

  it('hands pongs to the watchdog', () => {
    const onPong = vi.fn()
    const { relay } = setup({ onPong })

    relay.handleWebViewMessage(frame({ type: PANEL_PONG_TYPE, pingId: 4 }))

    expect(onPong).toHaveBeenCalledWith(4)
  })
})

describe('buildPanelDeliverScript', () => {
  it('calls the outer deliver global with the message as a JSON literal', () => {
    const script = buildPanelDeliverScript({ type: 'x', text: '</script> ' })
    const deliver = vi.fn()

    new Function('window', script)({ [PANEL_OUTER_DELIVER_GLOBAL]: deliver })

    expect(deliver).toHaveBeenCalledWith({ type: 'x', text: '</script> ' })
  })
})
