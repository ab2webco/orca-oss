import type { GameAgent } from '../../shared/orchestrator-game-state'
import type { RemoteMemberAgent } from '../../shared/orchestrator-game-remote-agent'

/** The state a waiting pane's own screen proves; read only for the lead and members (ORCA-1231). */
export type GameScreenStateOf = (agent: {
  paneKey: string
  agentType: string | null
  state: GameAgent['state']
}) => Promise<GameAgent['state']>

const readOrKeep = async (
  screenStateOf: GameScreenStateOf,
  agent: Parameters<GameScreenStateOf>[0]
): Promise<GameAgent['state']> => {
  try {
    return await screenStateOf(agent)
  } catch {
    return agent.state
  }
}

// Why drop the tool: it names the prompt that is gone, not what the agent does now.
export async function screenCheckedAgentOf(
  agent: GameAgent,
  screenStateOf: GameScreenStateOf | undefined
): Promise<GameAgent> {
  if (agent.state !== 'waiting' || !screenStateOf) {
    return agent
  }
  const state = await readOrKeep(screenStateOf, agent)
  if (state === 'waiting') {
    return agent
  }
  const { toolInput: _gone, ...rest } = agent
  return { ...rest, state, toolName: null }
}

/** The same check on this host's relay of a member to its Run home. */
export async function screenCheckedRemoteAgentOf(
  agent: RemoteMemberAgent,
  paneKey: string,
  screenStateOf: GameScreenStateOf
): Promise<RemoteMemberAgent> {
  if (agent.state !== 'waiting') {
    return agent
  }
  const state = await readOrKeep(screenStateOf, {
    paneKey,
    agentType: agent.agentType,
    state: 'waiting'
  })
  if (state === 'waiting' || state === 'idle') {
    return agent
  }
  const { toolName: _tool, toolInput: _input, ...rest } = agent
  return { ...rest, state }
}
