import type { TerminalViewAttributes } from '../../../shared/terminal-view-attributes'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'
import { useAppStore } from '@/store'

// Why short: this is best-effort decoration of a runtime that may be offline,
// and nothing the user did is waiting on it.
const PUBLISH_TIMEOUT_MS = 5_000

/** Last palette the renderer composed, kept so a later connect can replay it.
 *  The renderer only recomposes on an appearance change, which is not when a
 *  server arrives. */
let lastAttributes: TerminalViewAttributes | null = null
/** `${environmentId}|${serialized}` already delivered; a new server re-sends. */
let lastDelivered: string | null = null
let watchingRuntimeChanges = false

function activeEnvironmentId(): string | null {
  try {
    const target = getActiveRuntimeTarget({
      activeRuntimeEnvironmentId:
        useAppStore.getState().settings?.activeRuntimeEnvironmentId ?? null
    })
    return target.kind === 'environment' ? target.environmentId : null
  } catch {
    return null
  }
}

function deliver(environmentId: string, attributes: TerminalViewAttributes): void {
  const key = `${environmentId}|${JSON.stringify(attributes)}`
  if (key === lastDelivered) {
    return
  }
  lastDelivered = key
  void callRuntimeRpc(
    { kind: 'environment', environmentId },
    'terminal.publishViewAttributes',
    attributes,
    { timeoutMs: PUBLISH_TIMEOUT_MS }
  ).catch(() => {
    // Best effort. Clear the key so the next connect or appearance change
    // retries instead of trusting a delivery that never landed.
    lastDelivered = null
  })
}

/** Re-send the palette whenever the active server changes.
 *
 *  Why a subscription and not just the publish call: the renderer composes the
 *  palette on an appearance change and dedupes identical snapshots, so after
 *  the app has published once, connecting to a server produces no new call —
 *  and that server would keep an empty palette for the rest of the session.
 */
function watchRuntimeChanges(): void {
  if (watchingRuntimeChanges) {
    return
  }
  watchingRuntimeChanges = true
  let previous = activeEnvironmentId()
  useAppStore.subscribe(() => {
    const current = activeEnvironmentId()
    if (current === previous) {
      return
    }
    previous = current
    if (current && lastAttributes) {
      deliver(current, lastAttributes)
    }
  })
}

/** Hand the runtime that owns the terminals the palette its OSC responder needs.
 *
 *  Why this exists: the daemon answers OSC 4/10/11/12 and DSR ?996n on its own
 *  side, but only once a renderer has pushed colours — with none it stays
 *  silent by design. A silent responder is not harmless: it consumes the query
 *  without replying, so a TUI that asks the background colour before drawing
 *  (`gh auth login`) waits forever for an answer nobody will send.
 */
export function publishTerminalViewAttributesToActiveRuntime(
  attributes: TerminalViewAttributes
): void {
  lastAttributes = attributes
  watchRuntimeChanges()
  const environmentId = activeEnvironmentId()
  if (!environmentId) {
    // A desktop talking to itself already published over its own preload IPC.
    return
  }
  deliver(environmentId, attributes)
}

/** Test seam: drop the module state between tests. */
export function _resetRuntimeTerminalViewAttributesForTest(): void {
  lastAttributes = null
  lastDelivered = null
  watchingRuntimeChanges = false
}
