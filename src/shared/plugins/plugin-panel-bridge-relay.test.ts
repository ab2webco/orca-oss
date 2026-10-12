import { describe, expect, it, vi } from 'vitest'
import {
  PANEL_ACTION_REQUEST_TYPE,
  PANEL_ACTION_RESULT_TYPE,
  PANEL_CLOSE_ACTION,
  PANEL_MESSAGE_MAX_BYTES,
  PANEL_PONG_TYPE,
  type PluginPanelActionResultMessage
} from './plugin-panel-bridge'
import { createPanelBridgeRelay, type PanelBridgeRelayOptions } from './plugin-panel-bridge-relay'

const TOKEN = 't'.repeat(43)

const MESSAGES = {
  messageTooLarge: 'too large',
  tooManyRequests: 'too many',
  closeUnavailable: 'no close',
  sessionUnavailable: 'no session',
  resultTooLarge: 'result too large'
}

function channel() {
  const posted: PluginPanelActionResultMessage[] = []
  let current = true
  return {
    posted,
    retire: () => {
      current = false
    },
    reply: {
      post: (message: PluginPanelActionResultMessage) => posted.push(message),
      isCurrent: () => current
    }
  }
}

function relay(overrides: Partial<PanelBridgeRelayOptions> = {}) {
  const callPanelAction = vi.fn().mockResolvedValue({ ok: true, value: { n: 1 } })
  const handle = createPanelBridgeRelay({
    getSessionToken: () => TOKEN,
    callPanelAction,
    messages: MESSAGES,
    ...overrides
  })
  return { handle, callPanelAction }
}

function request(action = 'storage.get', params: unknown = { key: 'k' }) {
  return { type: PANEL_ACTION_REQUEST_TYPE, requestId: 'r1', action, params }
}

describe('createPanelBridgeRelay', () => {
  it('relays a request under the current session and posts the outcome back', async () => {
    const { handle, callPanelAction } = relay()
    const { posted, reply } = channel()

    handle(request(), reply)

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(callPanelAction).toHaveBeenCalledWith({
      sessionToken: TOKEN,
      action: 'storage.get',
      params: { key: 'k' }
    })
    expect(posted[0]).toEqual({
      type: PANEL_ACTION_RESULT_TYPE,
      requestId: 'r1',
      ok: true,
      value: { n: 1 }
    })
  })

  it('answers unavailable without reaching the host while no session is held', async () => {
    const { handle, callPanelAction } = relay({ getSessionToken: () => null })
    const { posted, reply } = channel()

    handle(request('storage.set', { key: 'k', value: 1 }), reply)

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(callPanelAction).not.toHaveBeenCalled()
    expect(posted[0]).toMatchObject({ ok: false, errorCode: 'unavailable', error: 'no session' })
  })

  it('refuses a request over the panel budget without relaying it', async () => {
    const { handle, callPanelAction } = relay()
    const { posted, reply } = channel()

    handle(request('storage.set', { value: 'x'.repeat(PANEL_MESSAGE_MAX_BYTES + 1) }), reply)

    expect(callPanelAction).not.toHaveBeenCalled()
    expect(posted[0]).toMatchObject({ ok: false, errorCode: 'invalid_request', error: 'too large' })
  })

  it('replaces a result over the result cap with an error instead of posting it', async () => {
    const { handle } = relay({
      maxResultBytes: 1024,
      callPanelAction: vi.fn().mockResolvedValue({ ok: true, value: 'x'.repeat(2048) })
    })
    const { posted, reply } = channel()

    handle(request(), reply)

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({
      ok: false,
      errorCode: 'action_failed',
      error: 'result too large'
    })
  })

  it('posts results of any size when no result cap is set', async () => {
    const value = 'x'.repeat(PANEL_MESSAGE_MAX_BYTES * 2)
    const { handle } = relay({ callPanelAction: vi.fn().mockResolvedValue({ ok: true, value }) })
    const { posted, reply } = channel()

    handle(request(), reply)

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ ok: true, value })
  })

  it('drops a reply whose channel stopped being current while the host answered', async () => {
    let resolve: (value: unknown) => void = () => {}
    const { handle } = relay({
      callPanelAction: vi.fn().mockReturnValue(new Promise((done) => (resolve = done)))
    })
    const { posted, reply, retire } = channel()

    handle(request(), reply)
    retire()
    resolve({ ok: true, value: null })

    await new Promise((done) => setTimeout(done, 0))
    expect(posted).toEqual([])
  })

  it('hands a valid pong to the watchdog without spending a reply', () => {
    const onPong = vi.fn()
    const { handle, callPanelAction } = relay({ onPong })
    const { posted, reply } = channel()

    handle({ type: PANEL_PONG_TYPE, pingId: 7 }, reply)

    expect(onPong).toHaveBeenCalledWith(7)
    expect(callPanelAction).not.toHaveBeenCalled()
    expect(posted).toEqual([])
  })

  it('answers a close before closing the page', async () => {
    const order: string[] = []
    const { handle } = relay({
      callPanelAction: vi.fn().mockResolvedValue({ ok: true, value: null }),
      closePanel: () => order.push('closed')
    })
    const { reply } = channel()

    handle(request(PANEL_CLOSE_ACTION, {}), {
      post: () => order.push('replied'),
      isCurrent: reply.isCurrent
    })

    await vi.waitFor(() => expect(order).toEqual(['replied', 'closed']))
  })
})
