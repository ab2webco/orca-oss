import type { AdvisorLogEntry } from '../types'
import { decisionOf, type AdvisorDecision } from './advisor-cues'
import type { Advisor } from './allies'
import { gameStrings, localizedNameOf } from './game-strings'
import type { AdvisorGesture, SceneAdvisor } from './scenes/index'

// What the Panel's advisor card says: who stands for Jev, this pane's model now, and its latest decisions.

const CARD_ROWS = 5

export type AdvisorCardRow = { key: string; text: string; gesture: AdvisorGesture | null }

export type AdvisorCard = {
  name: string
  line: string | null
  rows: AdvisorCardRow[]
  /** The latest decision's gesture, which the card's tile poses as. */
  pose: AdvisorGesture | null
}

/** Whether this pane is the lead's, so its main conversation is named the lead. */
export type AdvisorCardContext = { isLead: boolean }

const modelEffortOf = (model: string | null, effort: string | number | null): string =>
  [model ?? '', effort === null ? '' : String(effort)].filter((one) => one !== '').join('·')

// Why id: a subagent may lack a title; only the main conversation has no id.
const isMainOf = (decision: AdvisorDecision): boolean => (decision.id ?? null) === null

const subagentRowOf = (decision: AdvisorDecision): AdvisorCardRow => {
  const parts = [
    decision.title ?? decision.id ?? '',
    modelEffortOf(decision.model, decision.effort),
    decision.verdict
  ].filter((one) => one.trim() !== '')
  return { key: decision.key, text: `↳ ${parts.join(' · ')}`, gesture: decision.gesture }
}

// Why one row from the value: each logged switch of the main model is the same conversation.
const mainRowOf = (
  advisor: Advisor,
  latest: AdvisorDecision | undefined,
  context: AdvisorCardContext
): AdvisorCardRow | null => {
  const now = modelEffortOf(advisor.model, advisor.effort)
  if (now === '') {
    return null
  }
  const text = gameStrings().text
  const who = context.isLead ? text.lead : text.advisorMain
  return { key: `main|${now}`, text: `★ ${who} · ${now}`, gesture: latest?.gesture ?? null }
}

/** The log when it has any; before Jev's first logged decision, the agents running now. */
export const advisorCardOf = (
  sprite: SceneAdvisor,
  advisor: Advisor,
  log: readonly AdvisorLogEntry[],
  context: AdvisorCardContext
): AdvisorCard => {
  const decisions = log.length > 0 ? log : advisor.subagents.map(decisionOf)
  const line = advisor.line?.trim().split('\n')[0]?.trim() ?? ''
  const main = mainRowOf(advisor, decisions.findLast(isMainOf), context)
  const subagents = decisions.filter((one) => !isMainOf(one))
  const rows = [
    ...(main === null ? [] : [main]),
    ...subagents.slice(-(main === null ? CARD_ROWS : CARD_ROWS - 1)).map(subagentRowOf)
  ]
  return {
    name: localizedNameOf(sprite.name ?? gameStrings().text.advisor),
    line: line === '' ? null : line,
    rows,
    pose: decisions.at(-1)?.gesture ?? null
  }
}
