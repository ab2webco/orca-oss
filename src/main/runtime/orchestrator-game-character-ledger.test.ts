import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { GameHistoryRecord } from '../../shared/orchestrator-game-history'
import type { GameLateReviewCheck } from '../../shared/orchestrator-game-late-merges'
import {
  lateGameReviewChecks,
  payGameMerge,
  settleClosedGameReview
} from './orchestrator-game-character-ledger'
import { GameHistoryStore } from './orchestrator-game-history-store'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function storeIn(): { store: GameHistoryStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-ledger-'))
  dirs.push(dir)
  return { store: new GameHistoryStore(() => dir), dir }
}

const freed = (ticket: string, pr: string): GameHistoryRecord => ({
  ticket,
  repo: 'orca-wa-inbox',
  branch: `refs/heads/${ticket.toLowerCase()}`,
  agent: 'claude',
  account: null,
  launchedAt: null,
  endedAt: '2026-11-11T23:57:03.479Z',
  outcome: 'stopped',
  pr,
  lastReport: null,
  character: 'Merlín'
})

const xpOf = async (store: GameHistoryStore): Promise<[string, number][]> =>
  (await store.characters('repo-a')).map((one) => [one.key, one.xp])

// Why (ORCA-1170): an auto-released or stopped member's merge never reached its character.
describe('the character ledger', () => {
  it('pays a merge once, even when two polls race and after a restart', async () => {
    const { store, dir } = storeIn()
    const credit = { character: { key: 'arthur', name: 'Arthur' }, number: 41 }
    const merge = { ticket: 'CIN-1', at: '2026-11-12T03:00:00.000Z' }

    const paid = await Promise.all([
      payGameMerge(store, 'repo-a', credit, merge),
      payGameMerge(store, 'repo-a', credit, merge)
    ])
    const again = new GameHistoryStore(() => dir)

    expect(paid.toSorted()).toEqual([false, true])
    expect(await payGameMerge(again, 'repo-a', credit, merge)).toBe(false)
    expect(await xpOf(again)).toEqual([['arthur', 100]])
  })

  it('lists open PRs until a merge pays one or a close settles it, across a restart', async () => {
    const { store, dir } = storeIn()
    const merlin = { key: 'merlin', name: 'Merlín' }
    await store.append('repo-a', freed('WAINBOX-79', '#98 open'), merlin)
    await store.append('repo-a', freed('WAINBOX-80', '#99 open'), merlin)
    const checks = await lateGameReviewChecks(store, 'repo-a', () => 'merlin')
    expect(checks.map((one) => one.ticket)).toEqual(['WAINBOX-80', 'WAINBOX-79'])
    const [newest, oldest] = checks as [GameLateReviewCheck, GameLateReviewCheck]

    await payGameMerge(store, 'repo-a', oldest, { ...oldest, at: '2026-11-12T03:00:00.000Z' })
    await settleClosedGameReview(store, 'repo-a', newest)

    const again = new GameHistoryStore(() => dir)
    expect(await lateGameReviewChecks(again, 'repo-a', () => 'merlin')).toEqual([])
    expect(await xpOf(again)).toEqual([['merlin', 100]])
  })
})
