import type { GameAgent } from './orchestrator-game-state'

/**
 * A found session (ORCA-914) whose agent is not working or waiting, such as an earlier lead's
 * finished member or a lost pane: it holds no launch slot and loads no host (ORCA-1424).
 */
export const isLeftoverMember = (agent: Pick<GameAgent, 'found' | 'state'>): boolean =>
  agent.found === true && agent.state !== 'working' && agent.state !== 'waiting'

/** Adopt when its work goes on, else close it; a found pane on a paired host has no handle here. */
export function leftoverNextOf(
  agent: Pick<GameAgent, 'remote' | 'worktree'>,
  name: string
): string {
  const remote = agent.remote
  const adopt = `orca game adopt ${name} if its work goes on`
  if (!remote) {
    return `leftover (idle, no lead): ${adopt}, else orca game stop ${name}`
  }
  const env = `--environment ${remote.environmentId ?? remote.host}`
  const list = agent.worktree
    ? `orca terminal list ${env} --worktree "id:${agent.worktree.id}"`
    : `orca terminal list ${env}`
  return `leftover on ${remote.host} (idle, no lead): ${adopt}, else close its tab there (${list}, then orca terminal close ${env} --terminal <handle> --tab)`
}
