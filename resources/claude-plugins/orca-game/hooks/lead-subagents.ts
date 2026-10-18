import type { GameAgent, GameState } from '../types'

// Why: a subagent whose completion never arrives must not read "working" forever.
export const STALE_MS = 10 * 60 * 1000

export type LeadSubagent = { tool: string; at: number }

/** The lead's in-process subagents still running, keyed by their agent id. */
export type LeadSubagents = Map<string, LeadSubagent>

export const leadSubagentsOf = (): LeadSubagents => new Map()

/** The running subagents of this session's lead, fed by tool.call and turn.complete. */
export const runningLeadSubagents: LeadSubagents = leadSubagentsOf()

/** Records a subagent's call: it is working while it keeps calling; stale ones are dropped here. */
export function noteSubagentCall(
  running: LeadSubagents,
  agentId: string,
  tool: string,
  at: number
): void {
  for (const [id, one] of running) {
    if (at - one.at >= STALE_MS) {
      running.delete(id)
    }
  }
  running.set(agentId, { tool, at })
}

export function noteSubagentDone(running: LeadSubagents, agentId: string): void {
  running.delete(agentId)
}

const rowOf = (agentId: string, one: LeadSubagent): GameAgent => ({
  paneKey: `subagent:${agentId}`,
  displayName: one.tool,
  agentType: 'claude',
  state: 'working',
  toolName: one.tool,
  isLeader: false
})

// Why: a lead's subagents count as working teammates, never as members; only the orchestrator lead refuses them.
export function withLeadSubagents(
  state: GameState,
  running: LeadSubagents,
  now: number,
  isOrchestrator: boolean
): GameState {
  if (state.role !== 'lead' || !isOrchestrator) {
    return state
  }
  const live = [...running].filter(([, one]) => now - one.at < STALE_MS)
  if (live.length === 0) {
    return state
  }
  return { ...state, agents: [...state.agents, ...live.map(([id, one]) => rowOf(id, one))] }
}
