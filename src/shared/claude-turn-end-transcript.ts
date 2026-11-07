// A Stop hook that blocks resumes Claude's turn with tool hooks and no new prompt; if another hook
// then halts it, Claude never sends a second Stop and the pane would stay working. The transcript
// still records the end of every finished turn, so the hosts poll it while such a turn is open.
import {
  parseAgentHookJson,
  readLastTextFromTranscriptOnce,
  type HookListenerState
} from './agent-hook-listener'
import type { AgentHookSource } from './agent-hook-relay'

const CLAUDE_TURN_END_POLL_MS = 1_000
// Why two reads: one stale tail read must not end a turn whose new lines are not flushed yet.
const CLAUDE_TURN_END_CONFIRMATIONS = 2
const CLAUDE_TURN_END_POLL_MAX_MS = 30 * 60_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function claudeTurnMarkerOfLine(line: string): 'ended' | 'open' | undefined {
  let entry: unknown
  try {
    entry = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isRecord(entry) || entry.isSidechain === true) {
    return undefined
  }
  if (entry.type === 'user' || entry.type === 'assistant') {
    return 'open'
  }
  // Why: Claude writes turn_duration last in every finished turn; a blocked Stop writes only stop_hook_summary.
  return entry.type === 'system' && entry.subtype === 'turn_duration' ? 'ended' : undefined
}

export function claudeTranscriptTurnEnded(transcriptPath: string): boolean {
  return readLastTextFromTranscriptOnce(transcriptPath, claudeTurnMarkerOfLine) === 'ended'
}

/** The same hook body re-labelled as the Stop Claude never sent, with the transcript to watch. */
export function claudeMissingStopOfHookBody(
  body: unknown
): { stopBody: Record<string, unknown>; transcriptPath: string } | null {
  if (!isRecord(body)) {
    return null
  }
  let payload: unknown = body.payload
  if (typeof payload === 'string') {
    try {
      payload = parseAgentHookJson(payload)
    } catch {
      return null
    }
  }
  if (!isRecord(payload) || typeof payload.transcript_path !== 'string') {
    return null
  }
  const transcriptPath = payload.transcript_path
  const stopPayload: Record<string, unknown> = { ...payload, hook_event_name: 'Stop' }
  for (const toolField of ['tool_name', 'tool_input', 'tool_response', 'tool_use_id']) {
    delete stopPayload[toolField]
  }
  const record: Record<string, unknown> = { ...body, payload: stopPayload }
  delete record.hook_event_name
  delete record.hookEventName
  return { stopBody: record, transcriptPath }
}

export type ClaudeTurnEndPollerHost = {
  state: HookListenerState
  isListening: () => boolean
  /** Ingests the synthesized Stop through the host's normal hook path. */
  ingestStop: (stopBody: Record<string, unknown>) => void
}

export class ClaudeTurnEndPoller {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly host: ClaudeTurnEndPollerHost) {}

  clear(paneKey: string): void {
    const timer = this.timers.get(paneKey)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(paneKey)
    }
  }

  clearAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
  }

  /** Call after a hook was applied; polls only while the pane is in a post-Stop continuation. */
  schedule(source: AgentHookSource, paneKey: string, body: unknown): void {
    // Why: a nested non-Claude CLI inherits ORCA_PANE_KEY, so its hooks must not end a live poll.
    if (source !== 'claude') {
      return
    }
    this.clear(paneKey)
    const { state } = this.host
    const original = state.lastStatusByPaneKey.get(paneKey)
    if (
      !original ||
      original.payload.state !== 'working' ||
      !state.claudePostStopContinuationPaneKeys.has(paneKey)
    ) {
      return
    }
    const missing = claudeMissingStopOfHookBody(body)
    if (!missing) {
      return
    }
    const startedAt = Date.now()
    let confirmations = 0
    const tick = (): void => {
      this.timers.delete(paneKey)
      if (
        !this.host.isListening() ||
        state.lastStatusByPaneKey.get(paneKey) !== original ||
        !state.claudePostStopContinuationPaneKeys.has(paneKey)
      ) {
        return
      }
      confirmations = claudeTranscriptTurnEnded(missing.transcriptPath) ? confirmations + 1 : 0
      if (confirmations >= CLAUDE_TURN_END_CONFIRMATIONS) {
        this.host.ingestStop(missing.stopBody)
        return
      }
      if (Date.now() - startedAt < CLAUDE_TURN_END_POLL_MAX_MS) {
        this.arm(paneKey, tick)
      }
    }
    this.arm(paneKey, tick)
  }

  private arm(paneKey: string, tick: () => void): void {
    const timer = setTimeout(tick, CLAUDE_TURN_END_POLL_MS)
    this.timers.set(paneKey, timer)
    if (typeof timer.unref === 'function') {
      timer.unref()
    }
  }
}
