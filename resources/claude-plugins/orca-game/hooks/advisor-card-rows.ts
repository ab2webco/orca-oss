import type { AdvisorLogEntry } from '../types'
import { decisionOf, type AdvisorDecision } from './advisor-cues'
import type { Advisor } from './allies'
import { gameStrings, localizedNameOf } from './game-strings'
import type { AdvisorGesture, SceneAdvisor } from './scenes/index'

// What the Panel's advisor card says: who stands for Jev, its model now, and its latest decisions.

const CARD_ROWS = 5

export type AdvisorCardRow = { key: string; text: string; gesture: AdvisorGesture | null }

export type AdvisorCard = {
  name: string
  badge: string
  line: string | null
  rows: AdvisorCardRow[]
  /** The latest decision's gesture, which the card's tile poses as. */
  pose: AdvisorGesture | null
}

const modelEffortOf = (model: string | null, effort: string | number | null): string =>
  [model ?? '', effort === null ? '' : String(effort)].filter((one) => one !== '').join('·')

// Why id: a subagent may lack a title; only the main conversation has no id.
const rowOf = (decision: AdvisorDecision): AdvisorCardRow => {
  const isMain = (decision.id ?? null) === null
  const parts = [
    isMain ? gameStrings().text.advisorMain : (decision.title ?? decision.id ?? ''),
    modelEffortOf(decision.model, decision.effort),
    decision.verdict
  ].filter((one) => one.trim() !== '')
  return {
    key: decision.key,
    text: `${isMain ? '★' : '↳'} ${parts.join(' · ')}`,
    gesture: decision.gesture
  }
}

/** The log when it has any; before Jev's first logged decision, the agents running now. */
export const advisorCardOf = (
  sprite: SceneAdvisor,
  advisor: Advisor,
  log: readonly AdvisorLogEntry[]
): AdvisorCard => {
  const decisions = log.length > 0 ? log : advisor.subagents.map(decisionOf)
  const line = advisor.line?.trim().split('\n')[0]?.trim() ?? ''
  const rows = decisions.slice(-CARD_ROWS).map(rowOf)
  return {
    name: localizedNameOf(sprite.name ?? gameStrings().text.advisor),
    badge: modelEffortOf(advisor.model, advisor.effort),
    line: line === '' ? null : line,
    rows,
    pose: rows.at(-1)?.gesture ?? null
  }
}
