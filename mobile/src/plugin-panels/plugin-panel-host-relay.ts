import {
  PANEL_ACTION_RESULT_TYPE,
  type PluginPanelActionOutcome,
  type PluginPanelActionResultMessage
} from '../../../src/shared/plugins/plugin-panel-bridge'
import {
  createPanelBridgeRelay,
  type PanelActionCall
} from '../../../src/shared/plugins/plugin-panel-bridge-relay'
import { createPanelMessageBudget } from '../../../src/shared/plugins/plugin-panel-message-budget'
import { PANEL_OUTER_FORWARD_MAX_CHARS } from './plugin-panel-outer-document'

/** Cap on a result delivered into a phone panel. Desktop caps none; a phone
 *  still needs a bound, and a settings panel reads ~90 KB documents. */
export const PANEL_RESULT_MAX_BYTES = 1024 * 1024

// Envelope overhead above the forwarded JSON text: nonce, kind, quoting.
const ENVELOPE_MAX_CHARS = PANEL_OUTER_FORWARD_MAX_CHARS * 2 + 1024

const MESSAGES = {
  messageTooLarge: 'Message exceeds the size limit.',
  tooManyRequests: 'Too many requests.',
  closeUnavailable: 'This panel cannot be closed from inside it.',
  sessionUnavailable: 'Orca is not connected right now. Try again when it reconnects.',
  resultTooLarge: 'The result is too large to show on the phone.'
}

export type PluginPanelHostRelayOptions = {
  /** Secret baked into the outer page this WebView loaded. */
  nonce: string
  getSessionToken: () => string | null
  callPanelAction: (call: PanelActionCall) => Promise<PluginPanelActionOutcome>
  /** Posts into the panel frame through the outer page. */
  deliver: (message: PluginPanelActionResultMessage) => void
  /** False once this WebView load was replaced; late answers are dropped. */
  isCurrent: () => boolean
  onPong?: (pingId: number) => void
  closePanel?: () => void
  now?: () => number
}

type Envelope = { kind: 'frame'; data: unknown } | { kind: 'oversized'; requestId?: string }

function readEnvelope(raw: string, nonce: string): Envelope | null {
  if (raw.length > ENVELOPE_MAX_CHARS) {
    return null
  }
  try {
    const envelope = JSON.parse(raw) as { nonce?: unknown; kind?: unknown; payload?: unknown }
    if (typeof envelope !== 'object' || envelope === null || envelope.nonce !== nonce) {
      return null
    }
    if (envelope.kind === 'frame' && typeof envelope.payload === 'string') {
      return { kind: 'frame', data: JSON.parse(envelope.payload) as unknown }
    }
    if (envelope.kind === 'oversized') {
      const payload = envelope.payload as { requestId?: unknown } | null
      const requestId = payload?.requestId
      return {
        kind: 'oversized',
        requestId:
          typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 128
            ? requestId
            : undefined
      }
    }
  } catch {
    return null
  }
  return null
}

/** App side of a phone panel: proves a WebView message came from this load's
 *  outer page, then runs it through the same relay as desktop. */
export function createPluginPanelHostRelay(options: PluginPanelHostRelayOptions): {
  handleWebViewMessage: (raw: string) => void
} {
  const now = options.now ?? (() => Date.now())
  const budget = createPanelMessageBudget()
  const relay = createPanelBridgeRelay({
    getSessionToken: options.getSessionToken,
    callPanelAction: options.callPanelAction,
    onPong: options.onPong,
    closePanel: options.closePanel,
    maxResultBytes: PANEL_RESULT_MAX_BYTES,
    budget,
    now,
    messages: MESSAGES
  })
  const reply = { post: options.deliver, isCurrent: options.isCurrent }
  return {
    handleWebViewMessage: (raw) => {
      const envelope = readEnvelope(raw, options.nonce)
      if (!envelope) {
        return
      }
      if (envelope.kind === 'frame') {
        relay(envelope.data, reply)
        return
      }
      // Too big to forward is still a frame: it spends rate budget like any other.
      const refusal = budget.admit(now(), Number.POSITIVE_INFINITY)
      if (envelope.requestId && options.isCurrent()) {
        options.deliver({
          type: PANEL_ACTION_RESULT_TYPE,
          requestId: envelope.requestId,
          ok: false,
          errorCode: refusal === 'rate_limited' ? 'rate_limited' : 'invalid_request',
          error: refusal === 'rate_limited' ? MESSAGES.tooManyRequests : MESSAGES.messageTooLarge
        })
      }
    }
  }
}
