import type { EngineInterface, On } from 'claude-code'

import { readFleetText, refresh, viewOf } from './fleet-sync'
import { isLeadStarted } from './lead-started'

/** The session starts after which a lead no longer sees its members; a fresh start runs `game lead`. */
export type LeadBriefSource = 'resume' | 'compact'

export const isLeadBriefSource = (source: unknown): source is LeadBriefSource =>
  source === 'resume' || source === 'compact'

/** What a lead reads first when it comes back: its members now, paused ones included. */
export const leadBriefOf = (source: LeadBriefSource, fleet: string): string =>
  [
    `Orca: this lead conversation was ${source === 'resume' ? 'resumed' : 'compacted'}. Your members now (\`game fleet\`); answer about them from this or a fresh read, never from memory:`,
    '',
    fleet,
    ...(source === 'compact'
      ? [
          '',
          'If the summary lost your standing rules, run `"$ORCA_GAME_CLI" game lead` again before acting.'
        ]
      : [])
  ].join('\n')

/** The brief for this pane's started lead; undefined for any other session or when Orca cannot answer. */
export async function leadBriefContextOf(
  $: EngineInterface,
  source: unknown
): Promise<string | undefined> {
  if (!isLeadBriefSource(source) || !(await isLeadStarted($))) {
    return undefined
  }
  await refresh($)
  const { state } = await viewOf($)
  if (state?.role !== 'lead' || state.leadElsewhere !== undefined) {
    return undefined
  }
  const fleet = await readFleetText($)
  return fleet === undefined ? undefined : leadBriefOf(source, fleet)
}

export const registerLeadBrief = (on: On): void => {
  on('classic.SessionStart', async ($, e, next) => {
    const answered = await next(e)
    const brief = await leadBriefContextOf($, e.source).catch(() => undefined)
    return brief === undefined
      ? answered
      : { ...answered, additionalContext: [...(answered.additionalContext ?? []), brief] }
  })
}
