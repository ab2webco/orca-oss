import { describe, expect, it } from 'vitest'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'
import {
  REMOTE_PR_CAP_FRESH_MS,
  RemoteGamePrCaps,
  remotePrCapOf
} from './orchestrator-game-remote-pr-cap'

const leadState = (total: number | undefined) =>
  ({
    lead: { autostart: false, cap: 4, agent: 'claude' },
    ...(total === undefined ? {} : { project: { reviews: { total, url: null, items: [] } } })
  }) as unknown as OrchestratorGameState

describe('remotePrCapOf (ORCA-1301)', () => {
  it("sends the lead's open PRs and cap once its review list was read", () => {
    expect(remotePrCapOf(leadState(5))).toEqual({ open: 5, cap: 4 })
    expect(remotePrCapOf(leadState(0))).toEqual({ open: 0, cap: 4 })
  })

  it('sends nothing while the review list is off or unread', () => {
    expect(remotePrCapOf(leadState(undefined))).toBeUndefined()
  })
})

describe('RemoteGamePrCaps (ORCA-1301)', () => {
  it('keeps the latest count per Dispatch while it is fresh', () => {
    const caps = new RemoteGamePrCaps()
    caps.note('ctx_a', { open: 2, cap: 4 }, 1_000)
    caps.note('ctx_a', { open: 4, cap: 4 }, 2_000)

    expect(caps.freshOf('ctx_a', 2_000 + REMOTE_PR_CAP_FRESH_MS)).toEqual({ open: 4, cap: 4 })
    expect(caps.freshOf('ctx_b', 2_000)).toBeUndefined()
  })

  it('drops a count older than the freshness window', () => {
    const caps = new RemoteGamePrCaps()
    caps.note('ctx_a', { open: 4, cap: 4 }, 1_000)

    expect(caps.freshOf('ctx_a', 1_001 + REMOTE_PR_CAP_FRESH_MS)).toBeUndefined()
  })
})
