// Whether a tab close may retire its sleeping agent-session record (ORCA-272).
//
// A tab close is not evidence an agent finished — Cmd+W, the X button, and a
// failed pane reconnect all take the same 'user'/'cleanup' path as an agent that
// genuinely said it was done. The append-only session log (ORCA-236) is the only
// authority: a turn still "working" there means the close interrupted the agent,
// and the record must survive so the user can resume it. Anything the log cannot
// read is unknown, not finished, and must also survive.

import type {
  AgentProviderSessionMetadata,
  ResumableTuiAgent
} from '../../../../shared/agent-session-resume'
import type { AgentSessionLogReading } from '../../../../shared/agent-session-log-state'

export type SleepingAgentSessionIdentity = {
  paneKey: string
  agent: ResumableTuiAgent
  providerSession: AgentProviderSessionMetadata
}

export type ReadAgentSessionLogForIdentity = (identity: {
  agent: ResumableTuiAgent
  providerSession: AgentProviderSessionMetadata
}) => Promise<AgentSessionLogReading>

/** A finished turn is the only outcome that clears a record: no boundary, a
 *  boundary the scan could not reach, or an unreadable/unknown log all count
 *  as "cannot tell" and must preserve. Defensive against a malformed reading
 *  (a misbehaving transport, a stubbed caller in tests) — anything short of
 *  an explicit non-working `read: true` also preserves. */
export function sessionLogShowsFinishedTurn(reading: AgentSessionLogReading | null | undefined): boolean {
  return (
    typeof reading === 'object' &&
    reading !== null &&
    reading.read === true &&
    reading.state !== 'working'
  )
}

/** Resolves which of the given pane's sleeping records are safe to retire —
 *  i.e. the session log affirmatively shows the agent's last turn ended.
 *  Every failure mode (no reader wired, a rejected call, an unknown session)
 *  degrades to "preserve", never to "retire". */
export async function resolveRetirableSleepingAgentPaneKeys(
  identities: readonly SleepingAgentSessionIdentity[],
  readForIdentity: ReadAgentSessionLogForIdentity | undefined
): Promise<ReadonlySet<string>> {
  const retirable = new Set<string>()
  if (!readForIdentity || identities.length === 0) {
    return retirable
  }
  await Promise.all(
    identities.map(async (identity) => {
      let reading: AgentSessionLogReading
      try {
        reading = await readForIdentity({
          agent: identity.agent,
          providerSession: identity.providerSession
        })
      } catch {
        return
      }
      if (sessionLogShowsFinishedTurn(reading)) {
        retirable.add(identity.paneKey)
      }
    })
  )
  return retirable
}
