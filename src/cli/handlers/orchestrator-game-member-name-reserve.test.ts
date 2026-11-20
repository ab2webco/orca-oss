import { describe, expect, it } from 'vitest'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'
import { namesInUseOf } from './orchestrator-game-member-name-reserve'

const state = (over: Partial<OrchestratorGameState>): OrchestratorGameState =>
  ({ config: {}, agents: [], ...over }) as OrchestratorGameState

describe('namesInUseOf', () => {
  // ORCA-1304: an unnamed lead is "Lead", not a roster character, so no roster name is held for it.
  it("holds only the members' own names, never a roster name for the lead", () => {
    expect(namesInUseOf(state({}))).toEqual([])
    const member = {
      displayName: 'Arthur · ORCA-1 Fix it'
    } as OrchestratorGameState['agents'][number]
    expect(namesInUseOf(state({ agents: [member] }))).toEqual(['Arthur'])
  })
})
