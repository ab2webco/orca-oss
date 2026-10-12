import {
  PANEL_ACTION_RESULT_TYPE,
  PANEL_CLOSE_ACTION,
  PANEL_CONTROL_MESSAGE_MAX_BYTES,
  looksLikePanelActionRequest,
  parsePanelActionRequest,
  readPanelPongId,
  type PluginPanelActionOutcome,
  type PluginPanelActionResultMessage
} from './plugin-panel-bridge'
import {
  createPanelControlMessageBudget,
  createPanelMessageBudget,
  structuredCloneMessageBytes,
  type PanelMessageBudget
} from './plugin-panel-message-budget'

/**
 * Transport-agnostic host side of the panel bridge: budgets, parsing, relay to
 * the host action call, and the reply. The desktop iframe host and the mobile
 * WebView host both run every guest frame through this one function; each
 * proves the frame came from its panel before handing it over.
 */

export type PanelActionCall = {
  sessionToken: string
  action: string
  params?: unknown
}

/** Where the answer to one guest frame goes. `isCurrent` turns false once the
 *  requesting document or session is replaced, so a late answer is dropped. */
export type PanelReplyChannel = {
  post: (message: PluginPanelActionResultMessage) => void
  isCurrent: () => boolean
}

export type PanelBridgeRelayMessages = {
  messageTooLarge: string
  tooManyRequests: string
  closeUnavailable: string
  sessionUnavailable: string
  resultTooLarge: string
}

export type PanelBridgeRelayOptions = {
  /** Null while the host holds no session (released, backgrounded, reconnecting). */
  getSessionToken: () => string | null
  callPanelAction: (call: PanelActionCall) => Promise<PluginPanelActionOutcome>
  messages: PanelBridgeRelayMessages
  onPong?: (pingId: number) => void
  /** Closes the page hosting this panel; omitted on surfaces with nothing to close. */
  closePanel?: () => void
  /** Cap on a result posted back into the panel; omitted means uncapped. */
  maxResultBytes?: number
  budget?: PanelMessageBudget
  controlBudget?: PanelMessageBudget
  now?: () => number
}

export function createPanelBridgeRelay(
  options: PanelBridgeRelayOptions
): (data: unknown, reply: PanelReplyChannel) => void {
  const budget = options.budget ?? createPanelMessageBudget()
  const controlBudget = options.controlBudget ?? createPanelControlMessageBudget()
  const now = options.now ?? (() => Date.now())
  const messages = options.messages
  return (data, reply) => {
    const respond = (message: PluginPanelActionResultMessage): void => {
      if (reply.isCurrent()) {
        reply.post(message)
      }
    }
    // A valid pong is the one frame the host must never lose: it takes a
    // reserved lane so a panel saturating its data budget can still prove it
    // is alive. Only schema-valid pongs qualify, so near-miss pong-shaped junk
    // cannot drain the lane the real reply needs.
    const pongId = readPanelPongId(data)
    if (pongId !== null) {
      const timestamp = now()
      // One walk, capped at the smaller lane bound, serves both budgets.
      const pongBytes = structuredCloneMessageBytes(
        data,
        controlBudget.maxBytes ?? PANEL_CONTROL_MESSAGE_MAX_BYTES
      )
      // Charged to both: the data budget still meters this traffic, while a
      // refusal there cannot by itself silence liveness.
      budget.admit(timestamp, pongBytes)
      if (!controlBudget.admit(timestamp, pongBytes)) {
        options.onPong?.(pongId)
      }
      return
    }
    // Budgets run before parsing: a flood of malformed junk must not buy
    // free schema-validation CPU either.
    const refusal = budget.admit(now(), structuredCloneMessageBytes(data, budget.maxBytes))
    if (refusal) {
      const requestId =
        typeof data === 'object' && data !== null
          ? (data as { requestId?: unknown }).requestId
          : undefined
      if (typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 128) {
        respond({
          type: PANEL_ACTION_RESULT_TYPE,
          requestId,
          ok: false,
          errorCode: refusal === 'oversized' ? 'invalid_request' : 'rate_limited',
          error: refusal === 'oversized' ? messages.messageTooLarge : messages.tooManyRequests
        })
      }
      return
    }
    if (!looksLikePanelActionRequest(data)) {
      return
    }
    const parsed = parsePanelActionRequest(data)
    if (!parsed.ok) {
      if (parsed.requestId) {
        respond({
          type: PANEL_ACTION_RESULT_TYPE,
          requestId: parsed.requestId,
          ok: false,
          errorCode: 'invalid_request',
          error: parsed.error
        })
      }
      return
    }
    const { requestId, action, params } = parsed.request
    const closePanel = options.closePanel
    if (action === PANEL_CLOSE_ACTION && !closePanel) {
      respond({
        type: PANEL_ACTION_RESULT_TYPE,
        requestId,
        ok: false,
        errorCode: 'unavailable',
        error: messages.closeUnavailable
      })
      return
    }
    const sessionToken = options.getSessionToken()
    if (!sessionToken) {
      respond({
        type: PANEL_ACTION_RESULT_TYPE,
        requestId,
        ok: false,
        errorCode: 'unavailable',
        error: messages.sessionUnavailable
      })
      return
    }
    options
      .callPanelAction({ sessionToken, action, params })
      .then((outcome) => {
        if (action === PANEL_CLOSE_ACTION && outcome.ok && closePanel) {
          if (reply.isCurrent()) {
            // Why: reply first — closing unmounts the frame and a later reply is dropped.
            respond({
              type: PANEL_ACTION_RESULT_TYPE,
              requestId,
              ok: true,
              value: { closed: true }
            })
            closePanel()
          }
          return
        }
        if (!outcome.ok) {
          respond({
            type: PANEL_ACTION_RESULT_TYPE,
            requestId,
            ok: false,
            errorCode: outcome.code,
            error: outcome.error
          })
          return
        }
        const cap = options.maxResultBytes
        if (cap !== undefined && structuredCloneMessageBytes(outcome.value, cap) > cap) {
          respond({
            type: PANEL_ACTION_RESULT_TYPE,
            requestId,
            ok: false,
            errorCode: 'action_failed',
            error: messages.resultTooLarge
          })
          return
        }
        respond({ type: PANEL_ACTION_RESULT_TYPE, requestId, ok: true, value: outcome.value })
      })
      .catch((error: unknown) => {
        respond({
          type: PANEL_ACTION_RESULT_TYPE,
          requestId,
          ok: false,
          errorCode: 'action_failed',
          error: error instanceof Error ? error.message : String(error)
        })
      })
  }
}
