import type { PluginPanelActionOutcome } from '../../../../shared/plugins/plugin-panel-bridge'
import {
  createPanelBridgeRelay,
  type PanelActionCall
} from '../../../../shared/plugins/plugin-panel-bridge-relay'
import type { PanelMessageBudget } from '../../../../shared/plugins/plugin-panel-message-budget'
import { translate } from '@/i18n/i18n'

/**
 * Host side of the plugin panel postMessage bridge. Framework-free so
 * message validation, budgets, and relay behavior are directly
 * unit-testable; PluginPanel wires the returned listener to `window` while
 * the panel iframe is mounted.
 *
 * Main issues an opaque session while loading the mounted panel. The guest
 * never sees or supplies plugin identity, and main binds the session again.
 */

export type { PanelActionCall }

export type PanelBridgeHostOptions = {
  sessionToken: string
  /** The mounted panel iframe's contentWindow, or null when unmounted. */
  getPanelWindow: () => Window | null
  callPanelAction: (call: PanelActionCall) => Promise<PluginPanelActionOutcome>
  /** False once the requesting panel document/session has been replaced. */
  isActive?: () => boolean
  onPong?: (pingId: number) => void
  /** Closes the page hosting this panel; omitted on surfaces with nothing to close. */
  closePanel?: () => void
  /** Injectable for tests; defaults to the shared per-plugin budget. */
  budget?: PanelMessageBudget
  /** Reserved liveness budget; defaults to the shared control-frame budget. */
  controlBudget?: PanelMessageBudget
  now?: () => number
}

/** Relays a bridge call through the preload API, degrading to a bridge-level
 *  error when the preload predates the plugins.panelAction surface. */
export function callPanelActionViaPreload(
  call: PanelActionCall
): Promise<PluginPanelActionOutcome> {
  const panelAction = window.api?.plugins?.panelAction
  if (!panelAction) {
    return Promise.resolve({
      ok: false,
      code: 'unavailable',
      error: translate(
        'auto.components.rightSidebar.pluginPanelBridgeHost.actionsUnavailable',
        'Plugin actions are not available in this client.'
      )
    })
  }
  return panelAction(call)
}

export function createPanelBridgeMessageHandler(
  options: PanelBridgeHostOptions
): (event: MessageEvent) => void {
  const relay = createPanelBridgeRelay({
    getSessionToken: () => options.sessionToken,
    callPanelAction: options.callPanelAction,
    onPong: options.onPong,
    closePanel: options.closePanel,
    budget: options.budget,
    controlBudget: options.controlBudget,
    now: options.now,
    // Getters: translated when a reply is built, in the language active then.
    messages: {
      get messageTooLarge() {
        return translate(
          'auto.components.rightSidebar.pluginPanelBridgeHost.messageTooLarge',
          'Message exceeds the size limit.'
        )
      },
      get tooManyRequests() {
        return translate(
          'auto.components.rightSidebar.pluginPanelBridgeHost.tooManyRequests',
          'Too many requests.'
        )
      },
      get closeUnavailable() {
        return translate(
          'auto.components.rightSidebar.pluginPanelBridgeHost.closeUnavailable',
          'This panel cannot be closed from inside it.'
        )
      },
      // Desktop always holds its session while the frame is mounted, and caps
      // no results, so these two never reach a desktop panel.
      sessionUnavailable: '',
      resultTooLarge: ''
    }
  })
  return (event: MessageEvent): void => {
    const panelWindow = options.getPanelWindow()
    // Why: the sandboxed srcdoc frame has an opaque origin ("null"), so the
    // sending window's identity — not event.origin — is the only trustworthy
    // check that this message came from our panel and not another frame.
    if (!panelWindow || event.source !== panelWindow) {
      return
    }
    const requestingWindow = panelWindow
    relay(event.data, {
      isCurrent: () =>
        options.isActive?.() !== false && options.getPanelWindow() === requestingWindow,
      // Why: targetOrigin must be '*' — an opaque origin never matches a
      // concrete origin, so anything stricter would silently drop the reply.
      post: (message) => requestingWindow.postMessage(message, '*')
    })
  }
}
