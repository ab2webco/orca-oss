import { describe, expect, it, vi } from 'vitest'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { recordGameMerges } from './orchestrator-game-merge-record'

const MERGE = {
  kind: 'merged' as const,
  ticket: 'ORCA-923',
  text: 'PR #923 merged',
  key: 'merged ORCA-923 #923',
  merge: { provider: 'github' as const, number: 923, worktreeId: 'wt-m', perfect: true }
}

vi.mock('../../../../shared/orchestrator-game-observed-events', () => ({
  observedMergesOf: () => [MERGE]
}))

const leadState = { role: 'lead', agents: [] } as unknown as OrchestratorGameState

function runtimeWith(postEvent: (args: unknown) => Promise<unknown>): OrcaRuntimeService {
  return { getGameBoard: () => ({ postEvent }) } as unknown as OrcaRuntimeService
}

describe('recordGameMerges', () => {
  it('posts a merge once when the panel and the mod poll at the same time', async () => {
    const pending: (() => void)[] = []
    const postEvent = vi.fn(
      () =>
        new Promise((resolve) => {
          pending.push(() => resolve({ posted: true }))
        })
    )
    const runtime = runtimeWith(postEvent)
    const caller = { worktreeId: 'wt-lead', terminalHandle: 'term-lead' }

    const first = recordGameMerges(runtime, leadState, caller)
    const second = recordGameMerges(runtime, leadState, caller)
    for (const release of pending) {
      release()
    }
    await Promise.all([first, second])

    expect(postEvent).toHaveBeenCalledTimes(1)
  })

  it('tries again on the next poll when the board could not be written', async () => {
    const postEvent = vi
      .fn()
      .mockRejectedValueOnce(new Error('board locked'))
      .mockResolvedValue({ posted: true })
    const runtime = runtimeWith(postEvent)
    const caller = { worktreeId: 'wt-lead', terminalHandle: 'term-lead' }

    await recordGameMerges(runtime, leadState, caller)
    await recordGameMerges(runtime, leadState, caller)
    await recordGameMerges(runtime, leadState, caller)

    expect(postEvent).toHaveBeenCalledTimes(2)
  })

  it('posts with the caller identity and the merge', async () => {
    const postEvent = vi.fn().mockResolvedValue({ posted: true })
    const caller = { worktreeId: 'wt-lead', terminalHandle: 'term-lead' }

    await recordGameMerges(runtimeWith(postEvent), leadState, caller)

    expect(postEvent).toHaveBeenCalledWith({ ...caller, ...MERGE })
  })

  it('records nothing for a member', async () => {
    const postEvent = vi.fn().mockResolvedValue({ posted: true })

    await recordGameMerges(
      runtimeWith(postEvent),
      { role: 'member', agents: [] } as unknown as OrchestratorGameState,
      { worktreeId: 'wt-m', terminalHandle: 'term-m' }
    )

    expect(postEvent).not.toHaveBeenCalled()
  })
})
