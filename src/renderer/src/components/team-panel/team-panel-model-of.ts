import type { GameOwnerQuestion } from '../../../../shared/orchestrator-game-owner-questions'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import { teamCardsOf } from '../../../../shared/team-panel-member-cards'
import type {
  TeamInboxCounts,
  TeamPanelGameModel,
  TeamSection
} from '../../../../shared/team-panel-model-types'

function inboxOf(
  state: OrchestratorGameState,
  questions: readonly GameOwnerQuestion[] | null
): TeamSection<TeamInboxCounts> {
  if (!questions) {
    return { kind: 'unavailable' }
  }
  const inboxes = state.inboxes ?? []
  return {
    kind: 'ready',
    value: {
      forYou: questions.filter((one) => !one.answer).length,
      waiting: inboxes.reduce((sum, one) => sum + one.waiting.length, 0),
      threads: inboxes.length,
      answered: questions.filter((one) => one.answer).length
    }
  }
}

/**
 * The Team model from the lead's own `game.state` and its owner questions; null with no lead.
 * Fields game.state does not publish (Advisor, XP, arcade, metrics, PRs, queue, machines) stay
 * empty rather than guessed: their tickets fill them.
 */
export function teamPanelModelOf(args: {
  repoId: string
  projectName: string
  state: OrchestratorGameState
  /** Every question the lead asked the user, answered or not; null when the host could not list them. */
  questions: readonly GameOwnerQuestion[] | null
}): TeamPanelGameModel | null {
  const { state, questions } = args
  const openTickets = new Set(
    (questions ?? []).flatMap((one) =>
      !one.answer && one.ticket ? [one.ticket.toUpperCase()] : []
    )
  )
  const cards = teamCardsOf(state, openTickets)
  if (!cards) {
    return null
  }
  return {
    kind: 'team',
    repoId: args.repoId,
    projectName: args.projectName,
    lead: cards.lead,
    advisor: null,
    members: cards.members,
    metrics: { kind: 'unavailable' },
    xp: null,
    arcade: null,
    stopped: state.stopped ? { since: state.stopped.since, by: state.stopped.by } : null,
    // Why guarded: a paired host on an older build may send neither.
    scene: {
      id: typeof state.config?.scene === 'string' ? state.config.scene : null,
      extensions: state.extensions?.scenes ?? []
    },
    inbox: inboxOf(state, questions),
    prs: null,
    queue: null,
    machines: null
  }
}
