import { ORCHESTRATION_FEDERATION_MEMBER_REOPEN_PROTOCOL_VERSION } from '../../../shared/protocol-version'
import type { OrchestrationDb } from './db'
import { OrchestrationError } from './orchestration-error'
import { refuseRemoteMemberMail } from './remote-member-mail-refusal'
import type { RemoteDispatchAttachmentRow } from './types'

/** The lead handle a remote member's brief prints; no terminal on the member's host has it. */
export const RUN_HOME_COORDINATOR_HANDLE = 'Run home (relayed by Orca Lab)'

export function namesRunHome(to: string | undefined): boolean {
  return typeof to === 'string' && /^run home\b/i.test(to.trim())
}

export type SettledMemberMail = {
  from: string
  to?: string
  run?: string
  type: string
  subject: string
  body?: string
  priority?: string
  threadId?: string
  payload?: string
}

export type RunHomeRelayResult = {
  relay: {
    messageId: string
    sequence: number
    dispatchId: string
    destination: 'run_home'
    accepted: true
  }
}

/**
 * Relays a remote member's mail to its lead after its worker_done (ORCA-1345). Without this the
 * mail fell through to this host's inbox, where `--to "Run home"` was stored for a handle nobody
 * reads. Returns undefined when the mail is not for Run home; throws when it cannot get there.
 */
export function relaySettledRemoteMemberMail(
  db: OrchestrationDb,
  mail: SettledMemberMail,
  caller: {
    paneKey: string
    capability: string | undefined
    processIncarnation: string | null
    hasLocalDispatch: () => boolean
  }
): RunHomeRelayResult | undefined {
  const explicitHome = namesRunHome(mail.to)
  if (mail.run || (mail.to && !explicitHome) || caller.hasLocalDispatch()) {
    return undefined
  }
  const settled = db.findLatestSettledRemoteAttachmentForPane(caller.paneKey)
  if (!settled) {
    if (explicitHome) {
      throw runHomeUnreachable(mail.type, db.findLatestRemoteAttachmentForPane(caller.paneKey))
    }
    return undefined
  }
  if (mail.type === 'worker_done' || mail.type === 'heartbeat') {
    if (!explicitHome) {
      return undefined
    }
    throw new OrchestrationError(
      'dispatch_inactive',
      `Your ${mail.type} was not sent: Dispatch ${settled.dispatch_id} already reported its worker_done. Send the result with --type escalation --subject report and your --dispatch-capability.`
    )
  }
  if (mail.type === 'question') {
    throw new OrchestrationError(
      'invalid_argument',
      `Your question was not sent: Dispatch ${settled.dispatch_id} already reported, and only \`orca orchestration ask\` reopens it so the answer can come back. Ask it with that command.`
    )
  }
  if (settled.protocol_version < ORCHESTRATION_FEDERATION_MEMBER_REOPEN_PROTOCOL_VERSION) {
    // Why: a lead older than protocol 4 stops pulling a member once it reports, so a relay would sit unread.
    throw new OrchestrationError(
      'dispatch_reopen_unsupported',
      `Your ${mail.type} was not delivered: Dispatch ${settled.dispatch_id} already reported and the lead's Orca does not read mail from a member after that. Print it in this terminal for the lead to read there, and tell the person to update the lead's Orca.`,
      { dispatchId: settled.dispatch_id }
    )
  }
  const authority = {
    dispatchId: settled.dispatch_id,
    capability: caller.capability,
    paneKey: caller.paneKey,
    processIncarnation: caller.processIncarnation
  }
  if (!db.verifySettledRemoteAttachmentAuthority(authority)) {
    throw refuseRemoteMemberMail(db, {
      dispatchId: settled.dispatch_id,
      type: mail.type,
      refusal: !caller.capability
        ? 'capability_missing'
        : settled.process_incarnation !== caller.processIncarnation
          ? 'process_mismatch'
          : 'capability_mismatch'
    })
  }
  // Why the existing kind and payload: the lead's reopen watch already imports them from a settled member.
  const relay = db.enqueueFederationRelay({
    dispatchId: settled.dispatch_id,
    direction: 'to_home',
    kind: mail.type,
    payload: JSON.stringify({
      from: mail.from,
      subject: mail.subject,
      body: mail.body ?? '',
      type: mail.type,
      priority: mail.priority ?? 'normal',
      threadId: mail.threadId ?? null,
      payload: mail.payload ?? null
    })
  })
  return {
    relay: {
      messageId: relay.message_id,
      sequence: relay.sequence,
      dispatchId: relay.dispatch_id,
      destination: 'run_home',
      accepted: true
    }
  }
}

function runHomeUnreachable(
  type: string,
  latest: RemoteDispatchAttachmentRow | undefined
): OrchestrationError {
  const where = latest
    ? `Dispatch ${latest.dispatch_id} on this pane is ${latest.stage === 'released' ? 'released' : latest.state}, so nothing on this host relays to your lead any more.`
    : 'This pane holds no remote Dispatch, so nothing on this host relays to a lead.'
  return new OrchestrationError(
    'dispatch_inactive',
    `Your ${type} was not sent: "Run home" is not a terminal on this host but the lead of a remote Dispatch. ${where} Print your report in this terminal for the lead to read there, and wait for the lead to re-engage it.`,
    latest ? { dispatchId: latest.dispatch_id } : undefined
  )
}
