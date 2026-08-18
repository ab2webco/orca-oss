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
import {
  nativeChatLineDecoderForAgent,
  readNativeChatTranscriptTailFile,
  type NativeChatLineDecoder
} from './transcript-tail-reader'
import { nativeChatTurnLifecycleDecoderForAgent } from './transcript-turn-lifecycle'
import {
  decodeTranscriptQueuedInput,
  pendingQueuedInputCount,
  QUEUED_INPUT_UNSUPPORTED_REASON,
  transcriptAgentWritesQueuedInput,
  type TranscriptQueuedInputOperation
} from './transcript-queued-input'

/** Turn boundaries cluster at the tail; this bounds the scan on a multi-MB log. */
const TAIL_RECORD_LIMIT = 200

export type ReadAgentSessionLogStateArgs = {
  agent: AgentType
  sessionId: string
  transcriptPath?: string
}

export async function readAgentSessionLogState(
  args: ReadAgentSessionLogStateArgs
): Promise<AgentSessionLogReading> {
  const decodeMessage = resolveNativeChatTranscriptAgent(args.agent)
    ? nativeChatLineDecoderForAgent(args.agent)
    : null
  const decodeLifecycle = nativeChatTurnLifecycleDecoderForAgent(args.agent)
  if (!decodeMessage || !decodeLifecycle) {
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

  const queuedOperations: TranscriptQueuedInputOperation[] = []
  // Queued-input records are not messages; consuming them here keeps them out of
  // the tail reader's record budget while reusing its single pass over the tail.
  const decode: NativeChatLineDecoder = (line, fallbackId) => {
    const queued = decodeTranscriptQueuedInput(line)
    if (queued) {
      queuedOperations.push(queued)
      return null
    }
    return decodeMessage(line, fallbackId)
  }

  try {
    const page = await readNativeChatTranscriptTailFile(
      filePath,
      TAIL_RECORD_LIMIT,
      decode,
      false,
      undefined,
      decodeLifecycle
    )
    return foldAgentSessionLogState({
      lifecycle: page.lifecycle ?? null,
      queuedInput: resolveQueuedInput(args.agent, queuedOperations),
      unparsedRecords: (page.malformedRecordCount ?? 0) + (page.oversizedRecordCount ?? 0)
    })
  } catch {
    return { read: false, reason: 'session-log-unreadable' }
  }
}

function resolveQueuedInput(
  agent: AgentType,
  operations: TranscriptQueuedInputOperation[]
): AgentSessionLogQueuedInput {
  if (!transcriptAgentWritesQueuedInput(agent)) {
    return { supported: false, reason: QUEUED_INPUT_UNSUPPORTED_REASON }
  }
  // The tail reader walks backwards, so restore chronological order before netting.
  return { supported: true, pending: pendingQueuedInputCount(operations.toReversed()) }
}
