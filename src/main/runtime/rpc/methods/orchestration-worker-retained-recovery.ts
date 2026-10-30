import type { WorkerTerminalRetainedReason } from '../../orchestration/worker-terminal-ownership'

/** What a `retained` release answer means and what clears it, since `retained` alone reads as success (ORCA-864). */
export function retainedRecoveryOf(
  reason: WorkerTerminalRetainedReason,
  dispatchId: string,
  terminalHandle: string | null
): string {
  const close = terminalHandle
    ? `\`orca terminal close --terminal ${terminalHandle}\``
    : '`orca game stop <ticket>`'
  switch (reason) {
    case 'external_terminal':
      return `Release only closes a terminal this Dispatch opened, and it did not open this one; close it yourself with ${close}.`
    case 'ownership_transferred':
      return 'A later Dispatch took over this terminal; release that Dispatch instead.'
    case 'user_takeover':
      return `Someone typed in this terminal, so Orca no longer closes it; close it yourself with ${close}.`
    case 'user_requested':
      return `worker-retain kept this terminal; run worker-release --dispatch ${dispatchId} again to close it.`
    case 'no_owned_resource':
      return 'This Dispatch owns no terminal, so release has nothing to close; its member row ends when its pane closes.'
    case 'identity_unproven':
      return `The worker was stopped or abandoned and its terminal still runs a process Orca cannot prove is the worker's; close it yourself with ${close}.`
    case 'legacy_ambiguous':
      return `Orca cannot tell which Dispatch owns this terminal; close it yourself with ${close}.`
    case 'federation_unsupported':
      return 'The host cannot release remote workers yet; update Orca there.'
    case 'not_settled':
      return `The worker has not finished; stop it with worker-stop --dispatch ${dispatchId}, or wait for worker_done.`
  }
}
