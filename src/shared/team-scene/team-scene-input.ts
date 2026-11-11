import type { TeamAgentFacts, TeamPanelGameModel } from '../team-panel-model-types'
import { teamSceneSiteOf } from './team-scene-sites'
import type { TeamSceneActivity, TeamSceneAgentInput, TeamSceneInput } from './team-scene-types'

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

/** The scene's projection of the Team model; the summary text stands in for a report id. */
export function teamSceneInputOf(
  model: Pick<TeamPanelGameModel, 'lead' | 'advisor' | 'members'>
): TeamSceneInput {
  return {
    lead: agentOf(model.lead, model.lead.liveAction?.kind === 'question'),
    advisor: model.advisor ? { line: model.advisor.line } : null,
    members: model.members.map((m) => ({
      ...agentOf(m, m.needsYou),
      reportId: m.summary,
      mergedPr: m.pr?.state === 'merged' ? m.pr.number : null,
      site: teamSceneSiteOf(m)
    }))
  }
}
