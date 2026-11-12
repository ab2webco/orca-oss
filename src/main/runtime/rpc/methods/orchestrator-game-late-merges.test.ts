import { describe, expect, it, vi } from 'vitest'
import type { GameLateReviewCheck } from '../../../../shared/orchestrator-game-late-merges'
import {
  checkLateGameMerges,
  LATE_MERGE_CHECK_INTERVAL_MS,
  lateMergeCheckDue,
  type LateMergePort
} from './orchestrator-game-late-merges'

const check = (ticket: string, number: number): GameLateReviewCheck => ({
  ticket,
  number,
  branch: `refs/heads/${ticket.toLowerCase()}`,
  repo: 'orca-wa-inbox',
  character: { key: 'merlin', name: 'Merlín' }
})

function portWith(states: Record<number, string | null | Error>) {
  const port = {
    checks: vi.fn(async () => [
      check('WAINBOX-79', 98),
      check('WAINBOX-80', 99),
      check('WAINBOX-81', 100),
      check('WAINBOX-82', 101)
    ]),
    reviewStateOf: vi.fn(async (one: GameLateReviewCheck) => {
      const state = states[one.number]
      if (state instanceof Error) {
        throw state
      }
      return state ?? null
    }),
    pay: vi.fn(async () => undefined),
    settleClosed: vi.fn(async () => undefined)
  } satisfies LateMergePort
  return port
}

// Why (ORCA-1170): a PR that merges after its member was stopped never reached the character.
describe('checkLateGameMerges', () => {
  it('pays a merged PR, settles a closed one, and leaves an open one for the next look', async () => {
    const port = portWith({
      98: 'merged',
      99: 'closed',
      100: 'open',
      101: new Error('rate limited')
    })

    await checkLateGameMerges(port, '2026-11-12T03:00:00.000Z')

    expect(port.pay).toHaveBeenCalledTimes(1)
    expect(port.pay).toHaveBeenCalledWith(check('WAINBOX-79', 98), '2026-11-12T03:00:00.000Z')
    expect(port.settleClosed).toHaveBeenCalledTimes(1)
    expect(port.settleClosed).toHaveBeenCalledWith(check('WAINBOX-80', 99))
    expect(port.reviewStateOf).toHaveBeenCalledTimes(4)
  })
})

describe('lateMergeCheckDue', () => {
  it('looks once per project in each interval', () => {
    const last = new Map<string, number>()

    expect(lateMergeCheckDue(last, 'repo:a', 1_000)).toBe(true)
    expect(lateMergeCheckDue(last, 'repo:a', 1_000 + LATE_MERGE_CHECK_INTERVAL_MS - 1)).toBe(false)
    expect(lateMergeCheckDue(last, 'repo:b', 2_000)).toBe(true)
    expect(lateMergeCheckDue(last, 'repo:a', 1_000 + LATE_MERGE_CHECK_INTERVAL_MS)).toBe(true)
  })
})
