import type {
  TeamAgentFacts,
  TeamCondition,
  TeamMemberCard,
  TeamPanelGameModel,
  TeamQueueEntry
} from '../team-panel-model-types'
import type { TeamSceneDesk } from './team-scene-desk'
import { teamSceneDeskOf } from './team-scene-desk'
import { teamSceneSiteOf } from './team-scene-sites'
import type {
  TeamSceneActivity,
  TeamSceneAgentInput,
  TeamSceneHold,
  TeamSceneInput,
  TeamSceneMemberInput
} from './team-scene-types'

// Why exhaustive: a fall-through to resting let a gone, failed or queued member play at its desk.
const activityOf = (agent: TeamAgentFacts, needsYou: boolean): TeamSceneActivity => {
  if (needsYou) {
    return 'needsYou'
  }
  switch (agent.condition) {
    case 'working':
    case 'starting':
      return 'working'
    case 'idle':
    case 'done':
    case 'waiting':
      // Why the condition too: an unmerged finished turn reads idle on the card, not done.
      return agent.status === 'done' || agent.condition === 'done' ? 'done' : 'resting'
    case 'queued':
    case 'paused':
    case 'asleep':
    case 'limited':
    case 'unreachable':
    case 'loggedOut':
    case 'gone':
    case 'startFailed':
      // Why blocked: the card reads each as unable to work, never resting.
      return 'blocked'
  }
}

const agentOf = (
  agent: TeamAgentFacts & { characterKey: string | null },
  needsYou: boolean
): TeamSceneAgentInput => ({
  key: agent.paneKey,
  name: agent.name,
  characterKey: agent.characterKey,
  activity: activityOf(agent, needsYou),
  ...(agent.decisions ? { decisions: agent.decisions } : {})
})

// Why paused reads asleep: both are a session at rest that the owner can wake, never a failure.
const HOLD: Partial<Record<TeamCondition, TeamSceneHold>> = {
  limited: 'limited',
  paused: 'asleep',
  asleep: 'asleep',
  loggedOut: 'loggedOut',
  unreachable: 'unreachable',
  queued: 'queued',
  starting: 'starting'
}

// Why open only: a merged PR's checks are history, and none or neutral is no reading.
const ciOf = (m: TeamMemberCard): Pick<TeamSceneMemberInput, 'ci'> => {
  const open = m.pr?.state === 'open' || m.pr?.state === 'draft'
  const ci = open ? m.pr?.ci : undefined
  return ci === 'pending' || ci === 'failure' || ci === 'success' ? { ci } : {}
}

const deskOf = (
  m: TeamMemberCard,
  queue: readonly TeamQueueEntry[] | null
): { desk?: TeamSceneDesk } => {
  const desk = teamSceneDeskOf(m, queue)
  return desk ? { desk } : {}
}

/** The scene's projection of the Team model; the summary text stands in for a report id. */
export function teamSceneInputOf(
  model: Pick<TeamPanelGameModel, 'lead' | 'advisor' | 'members'> &
    Partial<Pick<TeamPanelGameModel, 'queue' | 'stopped'>>
): TeamSceneInput {
  // Why null when not ready: a hidden or loading Queue tab says nothing about the queue.
  const queue = model.queue?.kind === 'ready' ? model.queue.value : null
  return {
    lead: agentOf(model.lead, model.lead.liveAction?.kind === 'question'),
    advisor: model.advisor ? { line: model.advisor.line } : null,
    ...(model.stopped ? { stopped: true as const } : {}),
    members: model.members.map((m) => ({
      ...agentOf(m, m.needsYou),
      reportId: m.summary,
      mergedPr: m.pr?.state === 'merged' ? m.pr.number : null,
      site: teamSceneSiteOf(m),
      ...(m.condition === 'gone' || m.condition === 'startFailed' ? { away: true as const } : {}),
      ...deskOf(m, queue),
      ...(HOLD[m.condition] ? { hold: HOLD[m.condition] } : {}),
      ...ciOf(m)
    }))
  }
}
