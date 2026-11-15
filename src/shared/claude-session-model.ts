/** The model and effort a Claude session runs on, as its CLI names them. */
export type ClaudeSessionModel = { model?: string; effort?: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

/** An assistant transcript line's model and effort; undefined for any other line. */
export function claudeSessionModelOfTranscriptLine(line: string): ClaudeSessionModel | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }
  // Why skip a sidechain: a sub-agent's line names the sub-agent's model, not the session's.
  if (
    !isRecord(parsed) ||
    parsed.type !== 'assistant' ||
    parsed.isSidechain === true ||
    !isRecord(parsed.message)
  ) {
    return undefined
  }
  const model = textOf(parsed.message.model)
  // Why: Claude writes `<synthetic>` for messages no model produced, such as API errors.
  if (model === undefined || model === '<synthetic>') {
    return undefined
  }
  const effort = textOf(parsed.effort)
  return effort === undefined ? { model } : { model, effort }
}

/** The pane's pick plus what it last read, so an unchanged transcript is never re-read. */
export type ClaudeSessionModelState = ClaudeSessionModel & {
  /** The transcript's size at the last read, or at SessionStart. */
  transcriptBytes?: number
  /** The latest turn the API served in this session. */
  served?: ClaudeSessionModel
}

export type ClaudeTranscriptReader = {
  bytesOf: (transcriptPath: string) => number | undefined
  read: (transcriptPath: string) => ClaudeSessionModel | undefined
}

const withoutUndefined = (pick: ClaudeSessionModelState): ClaudeSessionModelState =>
  Object.fromEntries(
    Object.entries(pick).filter(([, value]) => value !== undefined)
  ) as ClaudeSessionModelState

/**
 * The pane's session model after a lead hook event. SessionStart names the model; every later
 * event re-reads the transcript once it grew, because a member works its ticket in one long turn
 * and a router (Jev) switches the model per step: the served turn wins over the hook's guess.
 */
export function claudeSessionModelOfHook(
  eventName: unknown,
  hookPayload: Record<string, unknown>,
  previous: ClaudeSessionModelState | undefined,
  transcript: ClaudeTranscriptReader
): ClaudeSessionModelState {
  const transcriptPath = textOf(hookPayload.transcript_path ?? hookPayload.transcriptPath)
  const bytes = transcriptPath === undefined ? undefined : transcript.bytesOf(transcriptPath)
  const hookEffort = isRecord(hookPayload.effort)
    ? textOf(hookPayload.effort.level)
    : textOf(hookPayload.effort)
  if (eventName === 'SessionStart') {
    return withoutUndefined({
      model: textOf(hookPayload.model),
      effort: hookEffort,
      transcriptBytes: bytes
    })
  }
  const grew =
    transcriptPath !== undefined &&
    bytes !== undefined &&
    (previous === undefined || bytes !== previous.transcriptBytes)
  const turn = grew ? transcript.read(transcriptPath) : undefined
  const served = turn ?? previous?.served
  return withoutUndefined({
    model: served?.model ?? textOf(hookPayload.model) ?? previous?.model,
    effort: served?.effort ?? hookEffort ?? previous?.effort,
    transcriptBytes: grew ? bytes : previous?.transcriptBytes,
    served
  })
}
