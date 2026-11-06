import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameHistoryStore } from './orchestrator-game-history-store'
import type { GameEvent } from '../../shared/orchestrator-game-events'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function store(): { store: GameHistoryStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-arcade-'))
  dirs.push(dir)
  return { store: new GameHistoryStore(() => dir), dir }
}

const merged = (number: number, perfect: boolean): GameEvent => ({
  at: '2026-11-06T10:00:00.000Z',
  kind: 'merged',
  ticket: 'CIN-1',
  text: null,
  by: 'lead',
  key: `merged CIN-1 #${number}`,
  merge: { provider: 'github', number, worktreeId: 'wt-1', perfect }
})

describe('GameHistoryStore arcade credits', () => {
  it('saves one credit per perfect merge it records, once, and keeps it after a restart', async () => {
    const { store: first, dir } = store()
    await Promise.all([
      first.appendEvent('repo-a', merged(4, true)),
      first.appendEvent('repo-a', merged(4, true)),
      first.appendEvent('repo-a', merged(5, false))
    ])

    const again = new GameHistoryStore(() => dir)
    expect(await again.arcade('repo-a')).toEqual({
      credits: 1,
      offer: { provider: 'github', number: 4 }
    })
    expect(await again.arcade('repo-b')).toEqual({ credits: 0, offer: null })
  })

  // Why: those merges were already offered by the terminal's countdown, which cannot tell played from passed.
  it('credits nothing for perfect merges a store held before it kept credits', async () => {
    const { store: first, dir } = store()
    await first.appendEvent('repo-a', merged(4, true))
    const file = join(dir, readdirSync(dir)[0]!)
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    delete saved.arcade
    writeFileSync(file, JSON.stringify(saved))

    const again = new GameHistoryStore(() => dir)
    expect(await again.arcade('repo-a')).toEqual({ credits: 0, offer: null })
    await again.appendEvent('repo-a', merged(4, true))
    expect(await again.arcade('repo-a')).toEqual({ credits: 0, offer: null })
  })

  it('applies a change under the same queue as the events, and leaves the file on null', async () => {
    const { store: history } = store()
    await history.appendEvent('repo-a', merged(4, true))
    const [spent] = await Promise.all([
      history.changeArcade('repo-a', (current) => ({
        next: { credits: current.credits - 1, offer: null },
        result: 'played'
      })),
      history.appendEvent('repo-a', merged(6, true))
    ])
    const kept = await history.changeArcade('repo-a', () => ({
      next: null,
      result: 'none'
    }))

    expect([spent, kept]).toEqual(['played', 'none'])
    expect(await history.arcade('repo-a')).toEqual({
      credits: 1,
      offer: { provider: 'github', number: 6 }
    })
  })

  it('carries the larger ledger when it adopts an orphaned project', async () => {
    const { store: history } = store()
    await history.appendEvent('old-key', merged(4, true))
    await history.appendEvent('old-key', merged(5, true))
    await history.appendEvent('new-key', merged(6, true))

    await history.adopt('old-key', 'new-key')
    expect((await history.arcade('new-key')).credits).toBe(2)
  })
})
