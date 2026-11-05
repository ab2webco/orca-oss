import type { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationError } from '../orchestration/orchestration-error'

/** Where a remote member's terminal lives; `data` of a `terminal_handle_stale` from its home (ORCA-976). */
export type RemoteMemberTerminalHost = { host: string; environmentId: string }

/**
 * A remote member's handle is not a pane of its home, so a home send can only fail; this names the
 * paired host instead of answering a bare `terminal_handle_stale`. Null for any other handle.
 */
export function remoteMemberTerminalError(
  runtime: OrcaRuntimeService,
  handle: string
): OrchestrationError | null {
  let federated
  try {
    federated = runtime.getOrchestrationDb().findFederatedDispatchOnTerminal(handle)
  } catch {
    // Why: an unopened orchestration DB must not turn a plain stale handle into another error.
    return null
  }
  if (!federated) {
    return null
  }
  const host = federated.environment_name
  const data: RemoteMemberTerminalHost = { host, environmentId: federated.environment_id }
  return new OrchestrationError(
    'terminal_handle_stale',
    `${handle} is not a terminal here: it runs on the paired host ${host}. Send to it with \`orca terminal send --environment ${host} --terminal ${handle}\`.`,
    data
  )
}
