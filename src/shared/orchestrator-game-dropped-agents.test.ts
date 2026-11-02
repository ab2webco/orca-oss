import { describe, expect, it } from 'vitest'
import {
  gameDropTargetOf,
  parseGameDroppedAgents,
  serializeGameDroppedAgents,
  splitDroppedGameAgents,
  withDroppedGameAgent,
  withoutDroppedGameAgent
} from './orchestrator-game-dropped-agents'
import type { GameAgent } from './orchestrator-game-state'

const agent = (over: Partial<GameAgent>): GameAgent => ({
  paneKey: 'tab:leaf',
  displayName: 'orca-907',
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: false,
  ...over
})

const local = agent({ worktree: { id: 'repo1::/wt/907', branch: 'b', displayName: 'orca-907' } })
const remote = agent({
  paneKey: 'remote-found:env_m1:tab:leaf',
  remote: { host: 'm1', environmentId: 'env_m1', stateKnown: true },
  worktree: { id: 'wt-915', branch: 'b', displayName: 'orca-915' }
})
const AT = '2026-11-02T10:00:00.000Z'

// Why: a dropped agent stays out of the lead's fleet across refreshes and restarts (ORCA-943).
describe('dropped game agents', () => {
  it('hides a dropped agent by host and worktree, never the lead', () => {
    const dropped = withDroppedGameAgent(
      withDroppedGameAgent([], { ...gameDropTargetOf(remote)!, name: 'ORCA-915', at: AT }),
      { ...gameDropTargetOf(local)!, name: 'ORCA-907', at: AT }
    )
    const lead = agent({ isLeader: true, worktree: local.worktree })
    const other = agent({ worktree: { id: 'wt-915', branch: 'b', displayName: 'x' } })

    expect(splitDroppedGameAgents([lead, local, remote, other], dropped)).toEqual({
      agents: [lead, other],
      dropped: [local, remote]
    })
  })

  it('keeps one entry per agent, and restoring removes it', () => {
    const once = withDroppedGameAgent([], { ...gameDropTargetOf(local)!, name: 'ORCA-907', at: AT })
    const twice = withDroppedGameAgent(once, {
      ...gameDropTargetOf(local)!,
      name: 'ORCA-907',
      at: AT
    })

    expect(twice).toEqual([
      { worktreeId: 'repo1::/wt/907', environmentId: null, name: 'ORCA-907', droppedAt: AT }
    ])
    expect(withoutDroppedGameAgent(twice, gameDropTargetOf(local)!)).toEqual([])
  })

  it('reads back what it wrote and skips entries it cannot read', () => {
    const list = withDroppedGameAgent([], {
      ...gameDropTargetOf(remote)!,
      name: 'ORCA-915',
      at: AT
    })
    const text = serializeGameDroppedAgents(list)

    expect(parseGameDroppedAgents(text)).toEqual(list)
    expect(
      parseGameDroppedAgents(JSON.stringify({ version: 1, dropped: [{ worktreeId: 4 }, ...list] }))
    ).toEqual(list)
    expect(parseGameDroppedAgents('not json')).toEqual([])
  })
})
