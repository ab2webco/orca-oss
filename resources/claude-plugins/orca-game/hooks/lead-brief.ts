import type { EngineInterface, On } from 'claude-code'

import type { GameLocale } from '../types'

import { readFleetText, refresh, viewOf } from './fleet-sync'
import { LEAD_SKILL } from './game-lead'
import { gameLocale } from './game-strings'
import { unmarkLeadStarted } from './lead-autostart'
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

const NOT_LEAD_WORDS: Readonly<Record<GameLocale, (handle: string) => string>> = {
  en: (handle) => `Not the lead: ${handle} leads this project`,
  es: (handle) => `No es el líder: ${handle} lidera este proyecto`
}

/** What a former lead reads when it comes back while another pane leads (ORCA-728). */
export const notLeadBriefOf = (handle: string): string =>
  `Orca: this session is no longer the project's lead: ${handle} leads it. Do not act as the lead: stop any report watcher you armed, do not arm one, and do not launch, dispatch, release or resume members. Tell the person that ${handle} is the lead pane, then keep working here as a plain session.`

/** `lead` for this pane's started lead, the other pane's handle when one leads instead. */
async function returningLeadOf(
  $: EngineInterface
): Promise<{ lead: true } | { elsewhere: string } | null> {
  if (!(await isLeadStarted($))) {
    return null
  }
  await refresh($)
  const { state } = await viewOf($)
  if (state?.role !== 'lead') {
    return null
  }
  return state.leadElsewhere === undefined
    ? { lead: true }
    : { elsewhere: state.leadElsewhere.handle }
}

/** The brief for this pane's started lead; undefined for any other session or when Orca cannot answer. */
export async function leadBriefContextOf(
  $: EngineInterface,
  source: LeadBriefSource
): Promise<string | undefined> {
  const fleet = await readFleetText($)
  return fleet === undefined ? undefined : leadBriefOf(source, fleet)
}

export const registerLeadBrief = (on: On): void => {
  on('classic.SessionStart', async ($, e, next) => {
    const answered = await next(e)
    const source = e.source
    if (!isLeadBriefSource(source)) {
      return answered
    }
    const returning = await returningLeadOf($).catch(() => null)
    if (returning === null) {
      return answered
    }
    if ('elsewhere' in returning) {
      // Why: its transcript still says it leads, so it would re-arm a watcher and read the board.
      await unmarkLeadStarted($).catch(() => undefined)
      $.ui.toast(NOT_LEAD_WORDS[gameLocale()](returning.elsewhere))
      const brief = notLeadBriefOf(returning.elsewhere)
      return { ...answered, additionalContext: [...(answered.additionalContext ?? []), brief] }
    }
    if (source === 'resume') {
      // Why: a restart killed the lead's report watcher, and its rules say whether to resume members.
      void $.command.run({ command: LEAD_SKILL, args: '' }).catch(() => undefined)
    }
    const brief = await leadBriefContextOf($, source).catch(() => undefined)
    return brief === undefined
      ? answered
      : { ...answered, additionalContext: [...(answered.additionalContext ?? []), brief] }
  })
}
