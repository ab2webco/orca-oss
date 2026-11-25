import type { GameAgent } from './orchestrator-game-state'

/**
 * A found session (ORCA-914) whose agent is not working or waiting, such as an earlier lead's
 * finished member or a lost pane: it holds no launch slot and loads no host (ORCA-1424).
 */
export const isLeftoverMember = (agent: Pick<GameAgent, 'found' | 'state'>): boolean =>
  agent.found === true && agent.state !== 'working' && agent.state !== 'waiting'

/** Adopt when its work goes on, else stop it; on a paired host the stop closes its pane there (ORCA-1396). */
export function leftoverNextOf(agent: Pick<GameAgent, 'remote'>, name: string): string {
  const adopt = `orca game adopt ${name} if its work goes on`
  return agent.remote
    ? `leftover on ${agent.remote.host} (idle, no lead): ${adopt}, else orca game stop ${name} closes its pane there`
    : `leftover (idle, no lead): ${adopt}, else orca game stop ${name}`
}

/** ` · 2 leftover, no slot held` for the fleet head; nothing when there are none. */
export const leftoverCountOf = (rows: readonly { leftover: boolean }[]): string => {
  const count = rows.filter((row) => row.leftover).length
  return count > 0 ? ` · ${count} leftover, no slot held` : ''
}
