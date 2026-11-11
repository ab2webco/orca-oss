import { gameCharacterLevelOf } from '../../../../shared/orchestrator-game-characters'
import { translate } from '@/i18n/i18n'
import type { GameOwnerQuestion } from '../../../../shared/orchestrator-game-owner-questions'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import { gameMembersRunningOf, teamActionsOf } from '../../../../shared/team-panel-actions'
import { teamAdvisorRowOf } from '../../../../shared/team-panel-activity-rows'
import { teamCardsOf, type TeamCards } from '../../../../shared/team-panel-member-cards'
import { teamMetricsOf } from '../../../../shared/team-panel-metrics'
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
import { teamTodoTicketsOf } from './team-panel-todo'

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

function advisorOf(state: OrchestratorGameState): TeamAdvisorRow | null {
  const advisor = state.agents.find((one) => one.isLeader)?.advisor
  return advisor ? teamAdvisorRowOf(advisor) : null
}

// Why null when absent: a host older than the saved plays publishes none, and none is not zero.
function arcadeOf(state: OrchestratorGameState): TeamPanelGameModel['arcade'] {
  return state.arcade
    ? { credits: state.arcade.credits, offerPr: state.arcade.offer?.number ?? null }
    : null
}

// Why: a folder has no worktree per member, so a card says where its member really runs.
const inFolderCardsOf = (cards: TeamCards): TeamCards => ({
  ...cards,
  members: cards.members.map((card) =>
    card.worktreeId === null || card.worktreeId === cards.lead.worktreeId
      ? { ...card, inFolder: true as const }
      : card
  )
})

/**
 * The Team model from the lead's own `game.state` and its owner questions; null with no lead.
 * XP comes from game.characters, read beside game.state, and stays empty when it is not.
 */
export function teamPanelModelOf(args: {
  repoId: string
  projectName: string
  state: OrchestratorGameState
  /** Every question the lead asked the user, answered or not; null when the host could not list them. */
  questions: readonly GameOwnerQuestion[] | null
  /** A folder workspace has no remote, so no PRs or queue. */
  isFolder?: boolean
  /** The project's characters XP summed; null when the host could not list them. */
  xp?: number | null
  /** The UI language, for the lead's default character name. */
  locale?: string
}): TeamPanelGameModel | null {
  const { state, questions } = args
  const openTickets = new Set(
    (questions ?? []).flatMap((one) =>
      !one.answer && one.ticket ? [one.ticket.toUpperCase()] : []
    )
  )
  const open = (questions ?? []).filter((one) => !one.answer)
  const oldest = open.toSorted((a, b) => a.askedAt.localeCompare(b.askedAt))[0]
  const read = teamCardsOf(
    state,
    openTickets,
    oldest ? { ticket: oldest.ticket } : null,
    args.locale
  )
  if (!read) {
    return null
  }
  const cards = args.isFolder ? inFolderCardsOf(read) : read
  const work = {
    // Why no host `panel`: it lags a toggle by a poll and, on a paired host, is that host's
    // settings; teamPanelModelWithSettings applies this window's instead.
    state: { ...state, panel: undefined },
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
    metrics: teamMetricsOf(state),
    // Why the game's curve: the level is what the characters earned, not a figure drawn here (ORCA-1094).
    xp: typeof args.xp === 'number' ? gameCharacterLevelOf(args.xp) : null,
    arcade: arcadeOf(state),
    stopped: state.stopped
      ? {
          since: state.stopped.since,
          by: state.stopped.by,
          membersRunning: gameMembersRunningOf(state)
        }
      : null,
    // Why guarded: a paired host on an older build may send neither.
    scene: {
      id: typeof state.config?.scene === 'string' ? state.config.scene : null,
      extensions: state.extensions?.scenes ?? []
    },
    actions: teamActionsOf(state),
    todo: teamTodoTicketsOf(state, cards.members),
    inbox: inboxOf(state, questions),
    prs: teamPrSectionOf(work),
    queue: teamQueueSectionOf(work),
    machines: teamMachinesSectionOf({ state: work.state, members: cards.members })
  }
}
