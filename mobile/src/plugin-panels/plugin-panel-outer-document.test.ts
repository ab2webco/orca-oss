import { describe, expect, it, vi } from 'vitest'
import {
  PANEL_CONTENT_HEIGHT_MAX_PX,
  PANEL_CONTENT_HEIGHT_MIN_PX,
  PANEL_CONTENT_HEIGHT_TYPE,
  PANEL_PONG_TYPE
} from '../../../src/shared/plugins/plugin-panel-bridge'
import { PLUGIN_PANEL_CSP } from '../../../src/shared/plugins/plugin-panel-shell'
import {
  PANEL_OUTER_DELIVER_GLOBAL,
  PANEL_OUTER_FORWARD_MAX_CHARS,
  buildPluginPanelOuterDocument,
  buildPluginPanelOuterRelayScript
} from './plugin-panel-outer-document'

const NONCE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

type Listener = (event: { source: unknown; data: unknown }) => void

function runRelay() {
  const listeners: Listener[] = []
  const frameWindow = { postMessage: vi.fn() }
  const frame = { contentWindow: frameWindow, style: { height: '' } }
  const bridge = { postMessage: vi.fn() }
  const window: Record<string, unknown> = {
    ReactNativeWebView: bridge,
    addEventListener: (type: string, listener: Listener) => {
      if (type === 'message') {
        listeners.push(listener)
      }
    }
  }
  const document = { getElementById: (id: string) => (id === 'orca-panel' ? frame : null) }
  new Function('window', 'document', buildPluginPanelOuterRelayScript(NONCE))(window, document)
  const fromFrame = (data: unknown) => listeners.forEach((l) => l({ source: frameWindow, data }))
  const forwarded = () =>
    bridge.postMessage.mock.calls.map(([text]) => JSON.parse(text as string) as unknown)
  return { window, frame, frameWindow, bridge, listeners, fromFrame, forwarded }
}

describe('buildPluginPanelOuterDocument', () => {
  const html = buildPluginPanelOuterDocument({
    panelDocument: '<p title="x">a & b</p>"><script>alert(1)</script>',
    nonce: NONCE,
    colorScheme: 'dark',
    background: '#0a0a0a'
  })

  it('nests the panel in a scripts-only sandbox frame and never grants same-origin', () => {
    expect(html).toMatch(/<iframe id="orca-panel" sandbox="allow-scripts" /)
    expect(html).not.toMatch(/allow-same-origin|allow-popups|allow-top-navigation|allow-forms/)
  })

  it('applies the panel CSP to the outer page so the inherited policy is never looser', () => {
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${PLUGIN_PANEL_CSP}">`
    )
  })

  it('escapes the panel document into srcdoc so it cannot break out of the attribute', () => {
    expect(html).toContain(
      'srcdoc="&lt;p title=&quot;x&quot;&gt;a &amp; b&lt;/p&gt;&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"'
    )
    expect(html.match(/<script>/g)).toHaveLength(1)
  })

  it('sizes to the phone and paints the app background before the panel loads', () => {
    expect(html).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    )
    expect(html).toContain('<html class="dark">')
    expect(html).toContain('background:#0a0a0a')
  })
})

describe('outer relay script', () => {
  it('forwards a frame from the panel to the app tagged with this load nonce', () => {
    const { fromFrame, forwarded } = runRelay()

    fromFrame({ type: 'orca-panel-action', requestId: 'r1', action: 'storage.get' })

    expect(forwarded()).toEqual([
      {
        nonce: NONCE,
        kind: 'frame',
        payload: JSON.stringify({
          type: 'orca-panel-action',
          requestId: 'r1',
          action: 'storage.get'
        })
      }
    ])
  })

  it('ignores messages that do not come from the panel frame', () => {
    const { listeners, bridge } = runRelay()

    listeners.forEach((l) => l({ source: null, data: { type: PANEL_PONG_TYPE, pingId: 1 } }))

    expect(bridge.postMessage).not.toHaveBeenCalled()
  })

  it('applies a clamped content height locally instead of forwarding it', () => {
    const { fromFrame, frame, bridge } = runRelay()

    fromFrame({ type: PANEL_CONTENT_HEIGHT_TYPE, height: 900.2 })
    expect(frame.style.height).toBe('901px')
    fromFrame({ type: PANEL_CONTENT_HEIGHT_TYPE, height: 2_000_000 })
    expect(frame.style.height).toBe(`${PANEL_CONTENT_HEIGHT_MAX_PX}px`)
    fromFrame({ type: PANEL_CONTENT_HEIGHT_TYPE, height: 1 })
    expect(frame.style.height).toBe(`${PANEL_CONTENT_HEIGHT_MIN_PX}px`)
    fromFrame({ type: PANEL_CONTENT_HEIGHT_TYPE, height: Number.NaN })
    expect(frame.style.height).toBe(`${PANEL_CONTENT_HEIGHT_MIN_PX}px`)
    expect(bridge.postMessage).not.toHaveBeenCalled()
  })

  it('reports an oversized or unserializable frame without forwarding its body', () => {
    const { fromFrame, forwarded } = runRelay()
    const cyclic: Record<string, unknown> = { requestId: 'r2' }
    cyclic.self = cyclic

    fromFrame({ requestId: 'r1', blob: 'x'.repeat(PANEL_OUTER_FORWARD_MAX_CHARS) })
    fromFrame(cyclic)

    expect(forwarded()).toEqual([
      { nonce: NONCE, kind: 'oversized', payload: { requestId: 'r1' } },
      { nonce: NONCE, kind: 'oversized', payload: { requestId: 'r2' } }
    ])
  })

  it('delivers app messages into the panel frame only', () => {
    const { window, frameWindow } = runRelay()
    const deliver = window[PANEL_OUTER_DELIVER_GLOBAL] as (message: unknown) => void

    deliver({ type: 'orca-panel-ping', pingId: 3 })

    expect(frameWindow.postMessage).toHaveBeenCalledWith(
      { type: 'orca-panel-ping', pingId: 3 },
      '*'
    )
  })
})
