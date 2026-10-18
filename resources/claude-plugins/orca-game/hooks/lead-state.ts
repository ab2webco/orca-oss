import type { GameAgent, GameAgentState, GameState } from '../types'

/** The lead's own state: orchestrating while its turn ended but a member still works or needs the person. */
export type LeadState = 'working' | 'waiting' | 'orchestrating' | 'sleeping'

/** What a card says and how it is colored: an agent's state, or the lead's orchestrating. */
export type CardState = GameAgentState | 'orchestrating'

// Why from agent states alone: Orca maps the lead's Stop to done, on any host and workspace kind.
export const leadStateOf = (state: Pick<GameState, 'agents'>): LeadState | undefined => {
  const lead = state.agents.find((agent) => agent.isLeader)
  if (lead === undefined) {
    return undefined
  }
  if (lead.state === 'working' || lead.state === 'waiting') {
    return lead.state
  }
  const isTeamActive = state.agents.some(
    (agent) => !agent.isLeader && (agent.state === 'working' || agent.state === 'waiting')
  )
  return isTeamActive ? 'orchestrating' : 'sleeping'
}

export const cardStateOf = (agent: GameAgent, state: Pick<GameState, 'agents'>): CardState =>
  agent.isLeader && leadStateOf(state) === 'orchestrating' ? 'orchestrating' : agent.state
