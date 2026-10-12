import type {
  PluginPanelActionErrorCode,
  PluginPanelActionOutcome
} from '../../../src/shared/plugins/plugin-panel-bridge'
import type { PanelActionCall } from '../../../src/shared/plugins/plugin-panel-bridge-relay'
import { isRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import type { RpcClient } from '../transport/rpc-client'

export type PluginPanelSessionState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }
  | { status: 'ready'; html: string; documentRevision: number }

export type PluginPanelSessionConditions = { connected: boolean; foreground: boolean }

type PluginPanelSessionOptions = {
  client: Pick<RpcClient, 'sendRequest'>
  pluginKey: string
  panelId: string
  onState: (state: PluginPanelSessionState) => void
  /** An action reached the wire and its answer was lost; the user must check. */
  onDeliveryUnknown: (action: string) => void
}

export const PANEL_ACTION_DELIVERY_UNKNOWN_ERROR =
  'The connection dropped before Orca answered. The action may have been applied; check before trying again.'
const PANEL_ACTION_NOT_SENT_ERROR = 'Orca is not connected right now. Try again when it reconnects.'

const ERROR_CODES: ReadonlySet<PluginPanelActionErrorCode> = new Set([
  'invalid_request',
  'unknown_method',
  'capability_denied',
  'consent_required',
  'panel_forbidden',
  'invalid_params',
  'rate_limited',
  'unavailable',
  'action_failed'
])

function readOutcome(result: unknown): PluginPanelActionOutcome {
  const outcome = (result as { outcome?: unknown } | null)?.outcome as
    | { ok?: unknown; value?: unknown; code?: unknown; error?: unknown }
    | undefined
  if (outcome?.ok === true) {
    return { ok: true, value: outcome.value }
  }
  if (outcome?.ok === false && typeof outcome.error === 'string') {
    const code = ERROR_CODES.has(outcome.code as PluginPanelActionErrorCode)
      ? (outcome.code as PluginPanelActionErrorCode)
      : 'action_failed'
    return { ok: false, code, error: outcome.error }
  }
  return { ok: false, code: 'action_failed', error: 'Orca returned an unreadable answer.' }
}

function readEntry(result: unknown): { html: string; sessionToken: string } | null {
  const entry = result as { html?: unknown; sessionToken?: unknown } | null
  return typeof entry?.html === 'string' && typeof entry.sessionToken === 'string'
    ? { html: entry.html, sessionToken: entry.sessionToken }
    : null
}

/**
 * Owns one panel's host session on a phone. The host binds a session to the
 * socket that opened it, so a reconnect needs a fresh one; the document stays
 * mounted while only its authority rotates. Actions go out exactly once.
 */
export class PluginPanelSession {
  private conditions: PluginPanelSessionConditions = { connected: false, foreground: false }
  private token: string | null = null
  private generation = 0
  private openingGeneration: number | null = null
  private currentHtml: string | null = null
  private documentRevision = 0
  private disposed = false

  constructor(private readonly options: PluginPanelSessionOptions) {}

  getSessionToken(): string | null {
    return this.token
  }

  setConditions(next: PluginPanelSessionConditions): void {
    if (this.disposed) {
      return
    }
    this.conditions = next
    if (!next.connected) {
      // The host revokes every session of a closed socket; nothing to send.
      this.generation += 1
      this.token = null
      return
    }
    if (!next.foreground) {
      this.generation += 1
      this.releaseHeldSession()
      return
    }
    if (this.token === null && this.openingGeneration !== this.generation) {
      this.open()
    }
  }

  retry(): void {
    if (!this.disposed && this.conditions.connected && this.conditions.foreground) {
      this.generation += 1
      this.open()
    }
  }

  dispose(): void {
    this.releaseHeldSession()
    this.generation += 1
    this.disposed = true
  }

  async callPanelAction(call: PanelActionCall): Promise<PluginPanelActionOutcome> {
    let response
    try {
      response = await this.options.client.sendRequest('plugins.panelAction', call, {
        failWhenDisconnected: true
      })
    } catch (error) {
      if (isRpcDeliveryUnknown(error)) {
        this.options.onDeliveryUnknown(call.action)
        return { ok: false, code: 'unavailable', error: PANEL_ACTION_DELIVERY_UNKNOWN_ERROR }
      }
      return { ok: false, code: 'unavailable', error: PANEL_ACTION_NOT_SENT_ERROR }
    }
    if (!response.ok) {
      return { ok: false, code: 'unavailable', error: response.error.message }
    }
    return readOutcome(response.result)
  }

  private open(): void {
    const generation = this.generation
    this.openingGeneration = generation
    if (this.currentHtml === null) {
      this.options.onState({ status: 'loading' })
    }
    const { pluginKey, panelId } = this.options
    this.options.client
      .sendRequest('plugins.readPanelEntry', { pluginKey, panelId })
      .then((response) => {
        const entry = response.ok ? readEntry(response.result) : null
        if (this.disposed || generation !== this.generation) {
          // Issued after the panel stopped needing it: hand it straight back.
          if (entry) {
            this.release(entry.sessionToken)
          }
          return
        }
        this.openingGeneration = null
        if (!response.ok) {
          this.options.onState({ status: 'error', message: response.error.message })
          return
        }
        if (!entry) {
          this.currentHtml = null
          this.options.onState({ status: 'unavailable' })
          return
        }
        this.token = entry.sessionToken
        if (entry.html !== this.currentHtml) {
          this.currentHtml = entry.html
          this.documentRevision += 1
          this.options.onState({
            status: 'ready',
            html: entry.html,
            documentRevision: this.documentRevision
          })
        }
      })
      .catch((error: unknown) => {
        if (this.disposed || generation !== this.generation) {
          return
        }
        this.openingGeneration = null
        this.options.onState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
      })
  }

  private releaseHeldSession(): void {
    const token = this.token
    this.token = null
    if (token) {
      this.release(token)
    }
  }

  private release(sessionToken: string): void {
    this.options.client
      .sendRequest('plugins.releasePanel', { sessionToken }, { failWhenDisconnected: true })
      .catch(() => {})
  }
}
