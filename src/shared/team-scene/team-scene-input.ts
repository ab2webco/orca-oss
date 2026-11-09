import type { TeamAgentFacts, TeamPanelGameModel } from '../team-panel-model-types'
import type { TeamSceneActivity, TeamSceneAgentInput, TeamSceneInput } from './team-scene-types'

// Why not status 'attention': it also means failed, and a failed member has nothing to ask.
// Why the condition too: an unmerged finished turn reads idle on the card, not done.
const activityOf = (agent: TeamAgentFacts, needsYou: boolean): TeamSceneActivity => {
  if (needsYou) {
    return 'needsYou'
  }
  if (agent.status === 'working') {
    return 'working'
  }
  return agent.status === 'done' || agent.condition === 'done' ? 'done' : 'resting'
}

const agentOf = (
  agent: TeamAgentFacts & { characterKey: string | null },
  needsYou: boolean
): TeamSceneAgentInput => ({
  key: agent.paneKey,
  name: agent.name,
  characterKey: agent.characterKey,
  activity: activityOf(agent, needsYou)
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
      mergedPr: m.pr?.state === 'merged' ? m.pr.number : null
    }))
  }
}
