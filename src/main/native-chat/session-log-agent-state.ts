// Reads a pane's agent state from its own session log. Nothing here looks at a
// terminal buffer, a title, or a foreground process (ORCA-236).

import type { AgentType } from '../../shared/native-chat-types'
import {
  foldAgentSessionLogState,
  type AgentSessionLogQueuedInput,
  type AgentSessionLogReading
} from '../../shared/agent-session-log-state'
import { resolveNativeChatTranscriptAgent } from '../../shared/native-chat-agent-support'
import { resolveSessionFilePath } from './session-file-resolver'
import { scanTranscriptTailForTurn, type TranscriptTailTurnScan } from './transcript-tail-turn-scan'
import { nativeChatTurnLifecycleDecoderForAgent } from './transcript-turn-lifecycle'
import {
  pendingQueuedInputCount,
  QUEUED_INPUT_UNSUPPORTED_REASON,
  transcriptAgentWritesQueuedInput
} from './transcript-queued-input'

export type ReadAgentSessionLogStateArgs = {
  agent: AgentType
  sessionId: string
  transcriptPath?: string
  /** Test seam: shrink the scan ceiling to exercise the beyond-scan branch. */
  maxScanBytes?: number
}

export async function readAgentSessionLogState(
  args: ReadAgentSessionLogStateArgs
): Promise<AgentSessionLogReading> {
  const decodeLifecycle = resolveNativeChatTranscriptAgent(args.agent)
    ? nativeChatTurnLifecycleDecoderForAgent(args.agent)
    : null
  if (!decodeLifecycle) {
    return { read: false, reason: 'agent-unsupported' }
  }

  let filePath: string | null
  try {
    filePath = await resolveSessionFilePath(args.agent, args.sessionId, {
      transcriptPath: args.transcriptPath
    })
  } catch {
    return { read: false, reason: 'session-log-unreadable' }
  }
  if (!filePath) {
    return { read: false, reason: 'session-log-missing' }
  }

  let scan: TranscriptTailTurnScan
  try {
    scan = await scanTranscriptTailForTurn(filePath, decodeLifecycle, args.maxScanBytes)
  } catch {
    return { read: false, reason: 'session-log-unreadable' }
  }
  return foldAgentSessionLogState({
    lifecycle: scan.lifecycle,
    queuedInput: resolveQueuedInput(args.agent, scan),
    unparsedRecords: scan.unparsedRecords,
    scanReachedCeiling: scan.reachedCeiling
  })
}

function resolveQueuedInput(
  agent: AgentType,
  scan: TranscriptTailTurnScan
): AgentSessionLogQueuedInput {
  if (!transcriptAgentWritesQueuedInput(agent)) {
    return { supported: false, reason: QUEUED_INPUT_UNSUPPORTED_REASON }
  }
  // The scan collects newest-first; restore chronological order before netting.
  return { supported: true, pending: pendingQueuedInputCount(scan.queuedOperations.toReversed()) }
}
