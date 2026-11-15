import { isAskUserQuestionTool } from '../../../src/shared/agent-question-answered-intent'
import type { GameMemberAdvisor } from '../../../src/shared/orchestrator-game-member-advisor'
import type { OrchestratorGameState } from '../../../src/shared/orchestrator-game-state'
import { teamAdvisorRowOf } from '../../../src/shared/team-panel-activity-rows'
import { teamCardsOf } from '../../../src/shared/team-panel-member-cards'
import type { TeamAdvisorRow, TeamLeadCard } from '../../../src/shared/team-panel-model-types'
import { toolDisplayWords } from '../../../src/shared/tool-display-words'
import type { TeamCardWords } from './team-card-words'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The lead and Jev's cards from the lead's own game.state, built as the desktop panel builds them. */
export function teamLeadCardsOf(
  state: Record<string, unknown>,
  questionTickets: ReadonlySet<string>,
  ownerAsk: { ticket: string | null } | null,
  locale: string
): { lead: TeamLeadCard | null; advisor: TeamAdvisorRow | null } {
  const agents = Array.isArray(state.agents) ? state.agents.filter(isRecord) : []
  const leader = agents.find((one) => one.isLeader === true)
  if (!leader) {
    return { lead: null, advisor: null }
  }
  const cards = teamCardsOf(
    { ...state, agents } as unknown as OrchestratorGameState,
    questionTickets,
    ownerAsk,
    locale
  )
  return {
    lead: cards?.lead ?? null,
    advisor: isRecord(leader.advisor)
      ? teamAdvisorRowOf(leader.advisor as unknown as GameMemberAdvisor)
      : null
  }
}

/** The lead's line, worded as the desktop's lead card: its open question, else its step. */
export function teamLeadLiveText(lead: TeamLeadCard, words: TeamCardWords): string {
  if (lead.ownerAsk) {
    return lead.ownerAsk.ticket ? words.leadAsksOn(lead.ownerAsk.ticket) : words.leadAsks
  }
  const action = lead.liveAction
  if (!action || (action.kind === 'tool' && isAskUserQuestionTool(action.tool))) {
    return words.condition[action ? 'waiting' : lead.condition]
  }
  if (action.kind === 'question') {
    return action.text
  }
  const step =
    action.kind === 'link'
      ? `${action.name} · ${action.id}`
      : action.detail
        ? `${action.tool} · ${action.detail}`
        : toolDisplayWords(action.tool)
  return lead.condition === 'working' ? words.orchestrating(step) : step
}
