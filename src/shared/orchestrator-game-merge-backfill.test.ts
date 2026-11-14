import { describe, expect, it } from 'vitest'
import {
  creditGameMerge,
  foldFreedMember,
  listGameCharacters
} from './orchestrator-game-characters'
import { gameMergedReviewsOf, type GameMergedReview } from './orchestrator-game-delivery'
import type { GameHistoryRecord } from './orchestrator-game-history'
import { lateReviewChecksOf } from './orchestrator-game-late-merges'
import { backfillGameMerges } from './orchestrator-game-merge-backfill'

// Shaped like the lead's 2026-11-14 history: a remote member stopped before its PR existed on the board.
const freed = (ticket: string, patch: Partial<GameHistoryRecord> = {}): GameHistoryRecord => ({
  ticket,
  repo: null,
  branch: `fabolivark/${ticket.toLowerCase()}`,
  agent: 'claude',
  account: 'member@example.com',
  launchedAt: '2026-11-13T14:02:11.000Z',
  endedAt: '2026-11-13T16:40:52.118Z',
  outcome: 'stopped',
  pr: null,
  lastReport: 'PR green, worker_done sent; lead merges',
  character: 'Wario',
  host: 'm1',
  ...patch
})

const merged = (number: number, tickets: string[], mergedAt = '2026-11-13T19:00:00Z') =>
  ({ number, openedAt: '2026-11-13T15:00:00Z', mergedAt, tickets }) satisfies GameMergedReview

const keyOf = (name: string): string => name.toLowerCase()
const xpOf = (stored: Record<string, unknown>): Record<string, number> =>
  Object.fromEntries(listGameCharacters(stored).map((one) => [one.key, one.xp]))

const foldAll = (records: readonly GameHistoryRecord[]): Record<string, unknown> =>
  records.reduce<Record<string, unknown>>((stored, record) => {
    const name = record.character ?? ''
    return foldFreedMember(stored, { key: keyOf(name), name }, record) ?? stored
  }, {})

describe('backfillGameMerges', () => {
  it('pays a PR that merged after its member was stopped with no PR on record', () => {
    const records = [freed('ORCA-1199')]
    const stored = foldAll(records)
    // The bug: the free pays a stop nothing, and the late look has no open PR to watch.
    expect(xpOf(stored)).toEqual({ wario: 0 })
    expect(lateReviewChecksOf(records, stored, keyOf)).toEqual([])

    const { next, paid } = backfillGameMerges(stored, records, [merged(1190, ['ORCA-1199'])], keyOf)

    expect(paid).toEqual([{ character: 'Wario', ticket: 'ORCA-1199', number: 1190, xp: 100 }])
    expect(xpOf(next ?? {})).toEqual({ wario: 100 })
  })

  it('pays each PR once, however often it runs and whoever paid it first', () => {
    const records = [freed('ORCA-1199'), freed('ORCA-1172', { character: 'Daisy' })]
    const reviews = [merged(1190, ['ORCA-1199']), merged(1191, ['ORCA-1172'])]
    // The late look or an observed merge already paid #1191, to another character.
    const stored =
      creditGameMerge(
        foldAll(records),
        { key: 'mario', name: 'Mario' },
        {
          ticket: 'ORCA-1172',
          number: 1191,
          at: 'x'
        }
      ) ?? {}

    const first = backfillGameMerges(stored, records, reviews, keyOf)
    const second = backfillGameMerges(first.next ?? {}, records, reviews, keyOf)

    expect(first.paid.map((one) => one.number)).toEqual([1190])
    expect(second).toEqual({ next: null, paid: [] })
    expect(xpOf(first.next ?? {})).toEqual({ wario: 100, mario: 100, daisy: 0 })
  })

  it('leaves a ticket whose free already ended merged, which paid its 100 then', () => {
    const records = [freed('ORCA-1150', { outcome: 'merged' })]
    const stored = foldAll(records)

    expect(backfillGameMerges(stored, records, [merged(1180, ['ORCA-1150'])], keyOf).paid).toEqual(
      []
    )
    expect(xpOf(stored)).toEqual({ wario: 100 })
  })

  it('tops up a QA free to the merge, and pays a stop recorded with its PR already merged', () => {
    const records = [
      freed('ORCA-1165', { outcome: 'qa' }),
      freed('ORCA-1158', { outcome: 'stopped', pr: '#1133 merged', character: 'Daisy' })
    ]
    const stored = foldAll(records)
    const reviews = [merged(1136, ['ORCA-1165']), merged(1133, ['ORCA-1158'])]

    const { next } = backfillGameMerges(stored, records, reviews, keyOf)

    expect(xpOf(next ?? {})).toEqual({ wario: 100, daisy: 100 })
  })

  it('never credits a free whose PR was another number, nor a free with no character', () => {
    const records = [
      freed('ORCA-1148', { pr: '#1105 open' }),
      freed('ORCA-1149', { character: null })
    ]
    const reviews = [merged(1120, ['ORCA-1148']), merged(1121, ['ORCA-1149'])]

    expect(backfillGameMerges(foldAll(records), records, reviews, keyOf).paid).toEqual([])
  })

  it('pays the retake that started before the merge, not one launched after it', () => {
    const records = [
      freed('ORCA-1171', { character: 'Rosalina', endedAt: '2026-11-13T12:00:00Z' }),
      freed('ORCA-1171', {
        character: 'Wario',
        launchedAt: '2026-11-13T20:00:00Z',
        endedAt: '2026-11-13T21:00:00Z'
      })
    ]

    const { paid } = backfillGameMerges(
      foldAll(records),
      records,
      [merged(1185, ['ORCA-1171'])],
      keyOf
    )

    expect(paid.map((one) => one.character)).toEqual(['Rosalina'])
  })
})

describe('gameMergedReviewsOf tickets', () => {
  it('keeps the tickets a GitHub title names', () => {
    const items = [
      {
        number: 1176,
        title: 'fix(game): pay a merged PR once (ORCA-1170, ORCA-1170 follow-up for UTF-8)',
        created_at: '2026-11-12T10:00:00Z',
        pull_request: { merged_at: '2026-11-13T10:00:00Z' }
      },
      {
        number: 1203,
        title: 'build(deps): bump astro',
        created_at: '2026-11-12T10:00:00Z',
        pull_request: { merged_at: '2026-11-13T10:00:00Z' }
      }
    ]

    expect(gameMergedReviewsOf(items, 'github').map((one) => one.tickets)).toEqual([
      ['ORCA-1170', 'UTF-8'],
      undefined
    ])
  })
})
