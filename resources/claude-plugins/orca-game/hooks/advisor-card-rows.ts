import type { AdvisorLogEntry } from '../types'
import { CI_GESTURES, decisionOf, type AdvisorDecision } from './advisor-cues'
import { ciLineOf, noticeLineOf, type Advisor, type AdvisorCi, type AdvisorNotice } from './allies'
import { gameStrings, localizedNameOf } from './game-strings'
import type { AdvisorGesture, SceneAdvisor } from './scenes/index'

// What the Panel's advisor card says: who stands for Jev, this pane's model now, its decisions, CI and the latest notice.

const CARD_ROWS = 5

// Why the same gestures as the strip's tones: a red CI run or block reads red in both places.
const NOTICE_GESTURES: Readonly<Record<AdvisorNotice['level'], AdvisorGesture | null>> = {
  info: null,
  warn: 'unsure',
  block: 'escalated'
}

export type AdvisorCardRow = { key: string; text: string; gesture: AdvisorGesture | null }

export type AdvisorCard = {
  name: string
  line: string | null
  rows: AdvisorCardRow[]
  /** The latest decision's gesture, which the card's tile poses as. */
  pose: AdvisorGesture | null
}

/** A live member as the lead's card lists it; `isJev` when its own Jev reported the model. */
export type AdvisorCardMember = { key: string; name: string; model: string | null; isJev: boolean }

/** Whether this pane is the lead's, so its main conversation is named the lead, and its members. */
export type AdvisorCardContext = { isLead: boolean; members?: readonly AdvisorCardMember[] }

const memberRowOf = (member: AdvisorCardMember): AdvisorCardRow => ({
  key: `member|${member.key}`,
  text: `${member.isJev ? '◆' : '◇'} ${[member.name, member.model ?? ''].filter((one) => one !== '').join(' · ')}`,
  gesture: null
})

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

const ciRowOf = (run: AdvisorCi): AdvisorCardRow => ({
  key: `ci|${run.id}`,
  text: ciLineOf(run),
  gesture: CI_GESTURES[run.status]
})

const noticeRowOf = (notice: AdvisorNotice): AdvisorCardRow => ({
  key: `notice|${notice.id}`,
  text: noticeLineOf(notice),
  gesture: NOTICE_GESTURES[notice.level]
})

// Why every live subagent: the band listed them all, so the card never drops one the history cap cut.
const subagentRowsOf = (
  advisor: Advisor,
  decisions: readonly AdvisorDecision[],
  room: number
): AdvisorCardRow[] => {
  const live = advisor.subagents.map(decisionOf)
  const liveKeys = new Set(live.map((one) => one.key))
  const past = decisions.filter((one) => !isMainOf(one) && !liveKeys.has(one.key))
  const kept = past.slice(Math.max(0, past.length - Math.max(0, room - live.length)))
  return [...kept, ...live].map(subagentRowOf)
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
  const latestNotice = advisor.notices.at(-1)
  const rows = [
    ...(main === null ? [] : [main]),
    ...(context.isLead ? (context.members ?? []).map(memberRowOf) : []),
    ...subagentRowsOf(advisor, decisions, main === null ? CARD_ROWS : CARD_ROWS - 1),
    ...advisor.ci.map(ciRowOf),
    ...(latestNotice === undefined ? [] : [noticeRowOf(latestNotice)])
  ]
  return {
    name: localizedNameOf(sprite.name ?? gameStrings().text.advisor),
    line: line === '' ? null : line,
    rows,
    pose: decisions.at(-1)?.gesture ?? null
  }
}
