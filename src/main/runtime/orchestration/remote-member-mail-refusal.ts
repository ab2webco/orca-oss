import type { OrchestrationDb } from './db'
import { OrchestrationError } from './orchestration-error'
import type { RemoteAttachmentRefusal } from './types'

export type RemoteMemberMailRefusal = RemoteAttachmentRefusal | 'sender_unauthenticated'

export const UNDELIVERABLE_NOTICE_KIND = 'undeliverable_notice'
// Why: the refused caller is unauthenticated, so the notice carries none of its text and is rate-limited.
const UNDELIVERABLE_NOTICE_INTERVAL_SECONDS = 300

const REFUSAL_CAUSE: Record<RemoteMemberMailRefusal, string> = {
  capability_missing: 'it carried no --dispatch-capability',
  capability_mismatch: 'its --dispatch-capability does not match this Dispatch',
  capability_revoked: 'this Dispatch no longer holds a capability on this host',
  process_mismatch: 'it did not come from the worker process this Dispatch started',
  sender_unauthenticated: "it did not carry the pane's ORCA_AGENT_LAUNCH_TOKEN"
}

const MEMBER_RECOVERY: Record<RemoteMemberMailRefusal, string> = {
  capability_missing:
    'Re-run the same command with --dispatch-capability copied from the CLI COMMANDS in your brief.',
  capability_mismatch:
    'Copy --dispatch-capability exactly from the CLI COMMANDS in your brief and re-run the command.',
  capability_revoked:
    'The Dispatch is stopping or was never started; stop and wait for the lead to re-engage this terminal.',
  process_mismatch:
    "Run the command from the member's own agent session; if that agent was restarted, the lead must start a fresh Dispatch.",
  sender_unauthenticated:
    "Run the command from the member's own agent session, not a shell that dropped Orca's environment."
}

/**
 * Tells Run home that a remote member's mail was refused on its host, then
 * returns the error the member sees. The lead otherwise never learns of it.
 */
export function refuseRemoteMemberMail(
  db: OrchestrationDb,
  args: { dispatchId: string; type: string; refusal: RemoteMemberMailRefusal }
): OrchestrationError {
  const notified = notifyRunHome(db, args)
  return new OrchestrationError(
    args.refusal === 'sender_unauthenticated'
      ? 'orchestration_sender_unauthenticated'
      : 'dispatch_capability_invalid',
    [
      `Your ${args.type} was not delivered: ${REFUSAL_CAUSE[args.refusal]}.`,
      MEMBER_RECOVERY[args.refusal],
      notified
        ? 'The lead was told that a message from this member was refused.'
        : 'The lead was not told; read your terminal output back to the lead once this is fixed.'
    ].join(' ')
  )
}

function notifyRunHome(
  db: OrchestrationDb,
  args: { dispatchId: string; type: string; refusal: RemoteMemberMailRefusal }
): boolean {
  try {
    if (
      db.hasRecentFederationRelayKind({
        dispatchId: args.dispatchId,
        direction: 'to_home',
        kind: UNDELIVERABLE_NOTICE_KIND,
        withinSeconds: UNDELIVERABLE_NOTICE_INTERVAL_SECONDS
      })
    ) {
      return true
    }
    db.enqueueFederationRelay({
      dispatchId: args.dispatchId,
      direction: 'to_home',
      kind: UNDELIVERABLE_NOTICE_KIND,
      payload: JSON.stringify({
        from: 'orca-worker-host',
        subject: `Undelivered ${args.type} from Dispatch ${args.dispatchId}`,
        body:
          `This member's ${args.type} was refused on its host because ${REFUSAL_CAUSE[args.refusal]}, ` +
          `so it never reached you. Its text is only in the member's terminal: ` +
          `orca orchestration worker-read --dispatch ${args.dispatchId}. ` +
          `The member was told: ${MEMBER_RECOVERY[args.refusal]}`,
        type: 'escalation',
        priority: 'high',
        threadId: null,
        payload: null
      })
    })
    return true
  } catch {
    // Why: a full relay queue must not replace the member's refusal with a quota error.
    return false
  }
}
