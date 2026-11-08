import { describe, expect, it } from 'vitest'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'
import { namesInUseOf } from './orchestrator-game-member-name-reserve'

const state = (over: Partial<OrchestratorGameState>): OrchestratorGameState =>
  ({ config: {}, agents: [], ...over }) as OrchestratorGameState

describe('namesInUseOf', () => {
  // ORCA-1094 row 1: a lead with no Lead name is the roster's last character; no member may take it.
  it("holds the lead's default character, and frees it once a Lead name is set", () => {
    expect(namesInUseOf(state({}))).toContain('Elaine')
    const named = state({ lead: { autostart: false, cap: 4, agent: 'claude', label: 'Alfred' } })
    expect(namesInUseOf(named)).not.toContain('Elaine')
  })
})
