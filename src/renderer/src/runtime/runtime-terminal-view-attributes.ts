import type { TerminalViewAttributes } from '../../../shared/terminal-view-attributes'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'
import { useAppStore } from '@/store'

// Why short: this is best-effort decoration of a runtime that may be offline,
// and nothing the user did is waiting on it.
const PUBLISH_TIMEOUT_MS = 5_000

/** Hand the runtime that owns the terminals the palette its OSC responder needs.
 *
 *  Why this exists: the daemon answers OSC 4/10/11/12 and DSR ?996n itself, but
 *  only once a renderer has pushed colours — with none it stays silent by
 *  design, so every colour query travels to the client and back. The reply
 *  returns after the process that asked it has already moved on, and the next
 *  reader finds `ESC ]` in its stdin. That is what kills `gh auth login` and
 *  every other interactive prompt in a terminal hosted on a server.
 */
export function publishTerminalViewAttributesToActiveRuntime(
  attributes: TerminalViewAttributes
): void {
  let target: ReturnType<typeof getActiveRuntimeTarget>
  try {
    target = getActiveRuntimeTarget({
      activeRuntimeEnvironmentId:
        useAppStore.getState().settings?.activeRuntimeEnvironmentId ?? null
    })
  } catch {
    return
  }
  if (target.kind !== 'environment') {
    // A desktop talking to itself already published over its own preload IPC.
    return
  }
  void callRuntimeRpc(target, 'terminal.publishViewAttributes', attributes, {
    timeoutMs: PUBLISH_TIMEOUT_MS
  }).catch(() => {
    // Best effort: an unreachable server re-receives the palette on the next
    // appearance apply, and until then its responder simply stays silent.
  })
}
