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
  if (!isRecord(parsed) || parsed.type !== 'assistant' || !isRecord(parsed.message)) {
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

const withoutUndefined = (pick: ClaudeSessionModel): ClaudeSessionModel => ({
  ...(pick.model !== undefined ? { model: pick.model } : {}),
  ...(pick.effort !== undefined ? { effort: pick.effort } : {})
})

/**
 * The pane's session model after a lead hook event. Interactive SessionStart names the model;
 * Stop's transcript turn is what the API actually ran, so it wins over a later `/model` guess.
 */
export function claudeSessionModelOfHook(
  eventName: unknown,
  hookPayload: Record<string, unknown>,
  previous: ClaudeSessionModel | undefined,
  readTranscript: (transcriptPath: string) => ClaudeSessionModel | undefined
): ClaudeSessionModel {
  const transcriptPath = textOf(hookPayload.transcript_path ?? hookPayload.transcriptPath)
  const isNewSession = eventName === 'SessionStart'
  // Why read on a first sight: after a restart the cache is empty until the next Stop.
  const shouldRead =
    transcriptPath !== undefined && !isNewSession && (eventName === 'Stop' || !previous)
  const turn = shouldRead ? readTranscript(transcriptPath) : undefined
  const base = isNewSession ? {} : (previous ?? {})
  const hookEffort = isRecord(hookPayload.effort)
    ? textOf(hookPayload.effort.level)
    : textOf(hookPayload.effort)
  return withoutUndefined({
    model: turn?.model ?? textOf(hookPayload.model) ?? base.model,
    effort: turn?.effort ?? hookEffort ?? base.effort
  })
}
