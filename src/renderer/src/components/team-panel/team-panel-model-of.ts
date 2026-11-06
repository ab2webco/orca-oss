import { translate } from '@/i18n/i18n'
import type { GameOwnerQuestion } from '../../../../shared/orchestrator-game-owner-questions'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import { teamLeadWorkOf } from '../../../../shared/team-panel-lead-work'
import { teamCardsOf } from '../../../../shared/team-panel-member-cards'
import type {
  TeamAdvisorRow,
  TeamInboxCounts,
  TeamPanelGameModel,
  TeamSection
} from '../../../../shared/team-panel-model-types'
import {
  teamMachinesSectionOf,
  teamPrSectionOf,
  teamQueueSectionOf,
  type TeamPrFailureTexts
} from '../../../../shared/team-panel-work-tabs'

const prFailureTexts = (): TeamPrFailureTexts => ({
  providerFailed: translate(
    'teamPanel.prs.providerFailed',
    'The provider did not answer. It retries on its own.'
  ),
  githubLimit: (minutes) =>
    translate(
      'teamPanel.prs.githubLimit',
      'GitHub API limit reached. It retries on its own in {{minutes}} min.',
      { minutes }
    )
})

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
      // Why not 'lead': that inbox holds what waits on the lead, which Waiting already counts.
      threads: inboxes.filter((one) => one.key !== 'lead').length,
      answered: questions.filter((one) => one.answer).length
    }
  }
}

// Why no calls: Jev's decisions live in the lead pane's own state, which never reaches game.state.
function advisorOf(state: OrchestratorGameState): TeamAdvisorRow | null {
  const advisor = state.agents.find((one) => one.isLeader)?.advisor
  if (!advisor) {
    return null
  }
  return {
    model: advisor.model,
    effort: advisor.effort,
    pinned: advisor.pinned,
    line: advisor.line ?? null,
    previous: advisor.previous ?? null,
    calls: []
  }
}

/**
 * The Team model from the lead's own `game.state` and its owner questions; null with no lead.
 * Fields game.state does not publish (XP, arcade, metrics) stay empty rather than guessed:
 * their tickets fill them.
 */
export function teamPanelModelOf(args: {
  repoId: string
  projectName: string
  state: OrchestratorGameState
  /** Every question the lead asked the user, answered or not; null when the host could not list them. */
  questions: readonly GameOwnerQuestion[] | null
  /** A folder workspace has no remote, so no PRs or queue. */
  isFolder?: boolean
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
  const work = {
    state,
    members: cards.members,
    isFolder: args.isFolder === true,
    texts: prFailureTexts(),
    now: Date.now()
  }
  return {
    kind: 'team',
    repoId: args.repoId,
    projectName: args.projectName,
    lead: cards.lead,
    advisor: advisorOf(state),
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
    prs: teamPrSectionOf(work),
    queue: teamQueueSectionOf(work),
    machines: teamMachinesSectionOf({ state, members: cards.members }),
    leadWork: teamLeadWorkOf(state)
  }
}
