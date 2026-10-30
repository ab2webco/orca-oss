import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import type { GameBoard } from './orchestrator-game-board'
import type { GameLeads } from './orchestrator-game-leads'

const UNSCANNED = 'repo1::/work/orca-874'

type ProjectReaders = {
  gameBoard: GameBoard
  gameLeads: GameLeads
}

// Why an empty map: before the first worktree scan lands, the requested id is not in it.
const runtimeBeforeScan = () => {
  const runtime = new OrcaRuntimeService(null)
  vi.spyOn(
    runtime as unknown as {
      getResolvedWorktreeMap: () => Promise<Map<string, unknown>>
    },
    'getResolvedWorktreeMap'
  ).mockResolvedValue(new Map())
  vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({
    worktrees: []
  } as never)
  const { gameBoard, gameLeads } = runtime as unknown as ProjectReaders
  return {
    runtime,
    inboxSummary: vi.spyOn(gameBoard, 'inboxSummary').mockResolvedValue([]),
    stopState: vi.spyOn(gameBoard, 'stopState').mockResolvedValue({ stopped: null }),
    leadElsewhere: vi.spyOn(gameLeads, 'leadElsewhere').mockResolvedValue(null)
  }
}

describe('game state for a worktree not yet scanned (ORCA-874)', () => {
  it("reads the project's inboxes by the requested worktree id", async () => {
    const { runtime, inboxSummary } = runtimeBeforeScan()
    await runtime.getOrchestratorGameState({ worktreeId: UNSCANNED })
    expect(inboxSummary).toHaveBeenCalledWith(expect.objectContaining({ worktreeId: UNSCANNED }))
  })

  it("reads the project's stop by the requested worktree id", async () => {
    const { runtime, stopState } = runtimeBeforeScan()
    await runtime.getOrchestratorGameState({ worktreeId: UNSCANNED })
    expect(stopState).toHaveBeenCalledWith(expect.objectContaining({ worktreeId: UNSCANNED }))
  })

  it("looks for the project's other lead by the requested worktree id", async () => {
    const { runtime, leadElsewhere } = runtimeBeforeScan()
    await runtime.getOrchestratorGameState({ worktreeId: UNSCANNED })
    expect(leadElsewhere).toHaveBeenCalledWith(expect.objectContaining({ worktreeId: UNSCANNED }))
  })
})
