import {
  PANEL_CONTENT_HEIGHT_INITIAL_PX,
  PANEL_CONTENT_HEIGHT_MAX_PX,
  PANEL_CONTENT_HEIGHT_MIN_PX,
  PANEL_CONTENT_HEIGHT_TYPE,
  PANEL_MESSAGE_MAX_BYTES
} from '../../../src/shared/plugins/plugin-panel-bridge'
import { PLUGIN_PANEL_CSP } from '../../../src/shared/plugins/plugin-panel-shell'
import type { PanelColorScheme } from '../../../src/shared/plugins/plugin-panel-shell-fill'

/**
 * The host-owned page a panel WebView loads. The plugin document runs one
 * level down, in the same `sandbox="allow-scripts"` srcdoc frame as desktop, so
 * it keeps an opaque origin and keeps talking to `window.parent`. This page is
 * the parent: it relays frames to the app and the app's replies back in.
 */

/** Global the app calls through injectJavaScript to post into the panel. */
export const PANEL_OUTER_DELIVER_GLOBAL = '__orcaPanelDeliver'

/** JSON text the outer page forwards. Above the panel byte budget on purpose:
 *  the app re-measures with the shared budget, this only bounds bridge traffic. */
export const PANEL_OUTER_FORWARD_MAX_CHARS = PANEL_MESSAGE_MAX_BYTES * 2

export type PanelOuterEnvelope =
  | { nonce: string; kind: 'frame'; payload: string }
  | { nonce: string; kind: 'oversized'; payload: { requestId?: string } }

export type PluginPanelOuterDocumentInput = {
  /** The filled shell: CSP, prelude and plugin HTML, exactly as desktop builds it. */
  panelDocument: string
  /** Per-load secret: frames without it did not come from this page's relay. */
  nonce: string
  colorScheme: PanelColorScheme
  background: string
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/** Kept as source text: Hermes ships bytecode, so a function's toString() is not its source. */
export function buildPluginPanelOuterRelayScript(nonce: string): string {
  const config = JSON.stringify({
    nonce,
    heightType: PANEL_CONTENT_HEIGHT_TYPE,
    minHeight: PANEL_CONTENT_HEIGHT_MIN_PX,
    maxHeight: PANEL_CONTENT_HEIGHT_MAX_PX,
    maxChars: PANEL_OUTER_FORWARD_MAX_CHARS
  }).replaceAll('<', '\\u003c')
  return `'use strict'
var cfg = ${config}
var frame = document.getElementById('orca-panel')
var bridge = window.ReactNativeWebView
function send(kind, payload) {
  try { bridge.postMessage(JSON.stringify({ nonce: cfg.nonce, kind: kind, payload: payload })) } catch (_) {}
}
function requestIdOf(data) {
  try {
    var id = data && typeof data === 'object' ? data.requestId : undefined
    return typeof id === 'string' && id.length > 0 && id.length <= 128 ? id : undefined
  } catch (_) { return undefined }
}
window.addEventListener('message', function (event) {
  // The frame's origin is opaque; its window identity is the only check worth making.
  if (!frame || event.source !== frame.contentWindow) return
  var data = event.data
  if (data && typeof data === 'object' && data.type === cfg.heightType) {
    var height = data.height
    if (typeof height === 'number' && isFinite(height) && height > 0) {
      frame.style.height = Math.min(Math.max(Math.ceil(height), cfg.minHeight), cfg.maxHeight) + 'px'
    }
    return
  }
  var text
  try { text = JSON.stringify(data) } catch (_) { text = undefined }
  if (typeof text !== 'string' || text.length > cfg.maxChars) {
    var requestId = requestIdOf(data)
    send('oversized', requestId ? { requestId: requestId } : {})
    return
  }
  send('frame', text)
})
Object.defineProperty(window, '${PANEL_OUTER_DELIVER_GLOBAL}', {
  value: function (message) {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage(message, '*')
  },
  writable: false,
  configurable: false
})
`
}

/** Script the app injects to post one message into the panel frame. */
export function buildPanelDeliverScript(message: unknown): string {
  return `window.${PANEL_OUTER_DELIVER_GLOBAL}(${JSON.stringify(message)});true;`
}

export function buildPluginPanelOuterDocument(input: PluginPanelOuterDocumentInput): string {
  return (
    '<!doctype html>\n' +
    `<html class="${input.colorScheme}">\n` +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    // Why: a srcdoc frame inherits this page's policy, so it must be exactly the panel's.
    `<meta http-equiv="Content-Security-Policy" content="${PLUGIN_PANEL_CSP}">\n` +
    '<style>\n' +
    `html,body{margin:0;padding:0;background:${input.background};color-scheme:${input.colorScheme}}\n` +
    `iframe{display:block;width:100%;border:0;height:${PANEL_CONTENT_HEIGHT_INITIAL_PX}px;min-height:100vh}\n` +
    '</style>\n' +
    '</head>\n' +
    '<body>\n' +
    // SECURITY: never add allow-same-origin — the panel must stay an opaque origin.
    `<iframe id="orca-panel" sandbox="allow-scripts" srcdoc="${escapeAttribute(input.panelDocument)}"></iframe>\n` +
    `<script>${buildPluginPanelOuterRelayScript(input.nonce)}</script>\n` +
    '</body>\n' +
    '</html>\n'
  )
}
