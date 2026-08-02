import type { AgentStatusIpcPayload } from '../../../shared/agent-status-types'
import type { ExactWorkerProviderSession } from '../../../shared/orchestration-worker-output'

type ExactWorkerProviderSessionQuery = {
  paneKey: string
  processIncarnation: string
  connectionId: string | null | undefined
  launchToken: string | null | undefined
  observedAfter: number
  statuses: readonly AgentStatusIpcPayload[]
}

function select(
  args: ExactWorkerProviderSessionQuery,
  acceptProviderSessionOnly: boolean
): ExactWorkerProviderSession | null {
  const status = args.statuses
    .filter(
      (entry) =>
        entry.paneKey === args.paneKey &&
        (args.connectionId === undefined || entry.connectionId === args.connectionId) &&
        (!args.launchToken || entry.launchToken === args.launchToken) &&
        (acceptProviderSessionOnly || entry.providerSessionOnly !== true) &&
        entry.providerSession !== undefined &&
        entry.agentType !== undefined &&
        entry.receivedAt >= args.observedAfter
    )
    .sort((left, right) => right.receivedAt - left.receivedAt)[0]
  if (!status?.providerSession || !status.agentType) {
    return null
  }
  return {
    paneKey: args.paneKey,
    processIncarnation: args.processIncarnation,
    agent: status.agentType,
    providerSession: { ...status.providerSession },
    observedAt: status.receivedAt
  }
}

/** "What is this worker doing" — a resume-identity placeholder is not an answer. */
export function selectExactWorkerProviderSession(
  args: ExactWorkerProviderSessionQuery
): ExactWorkerProviderSession | null {
  return select(args, false)
}

/**
 * "Which session is live in this pane" — answered by the resume-identity row a
 * just-resumed, idle agent reports, which is the only observation an account
 * switch can wait for before the user types anything (ORCA-168).
 */
export function selectExactWorkerProviderSessionIdentity(
  args: ExactWorkerProviderSessionQuery
): ExactWorkerProviderSession | null {
  return select(args, true)
}
