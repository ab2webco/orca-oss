import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameHistoryStore } from './orchestrator-game-history-store'
import { GameTeamXpLedger } from './orchestrator-game-team-xp-ledger'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function ledgerIn(dir: string): GameTeamXpLedger {
  return new GameTeamXpLedger({
    store: new GameHistoryStore(() => dir),
    projectOf: async () => ({ key: 'repo:a', isMember: false }) as never,
    now: () => 5
  })
}

const merged = {
  id: 'review-merged:github#41@wt-12',
  kind: 'review-merged' as const,
  xp: 100,
  label: 'ORCA-12 · #41 merged'
}

describe('GameTeamXpLedger', () => {
  it('keeps each reported reward once across a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-team-xp-'))
    dirs.push(dir)
    const first = await ledgerIn(dir).award({}, [merged])
    expect(first).toMatchObject({ added: 1, teamXp: { total: 100 } })
    const again = await ledgerIn(dir).award({}, [{ ...merged, id: 'review-merged:github#41@wt-1' }])
    expect(again).toMatchObject({ added: 0, teamXp: { total: 100 } })
    expect((await ledgerIn(dir).read({})).recent).toEqual([
      { ...merged, id: 'review-merged:#41', at: 5 }
    ])
  })

  // Why: a file the previous release wrote has characters and no rows; its total must stay.
  it("reads a previous release's file at its characters XP and keeps its other keys on write", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-team-xp-'))
    dirs.push(dir)
    await new GameHistoryStore(() => dir).changeCharacters('repo:a', () => ({
      next: {
        merlin: { key: 'merlin', name: 'Merlín', xp: 1400, tickets: 3, recent: [], applied: [] }
      },
      result: undefined
    }))
    const [file] = readdirSync(dir)
    const path = join(dir, file!)
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), later: 1 }))
    expect((await ledgerIn(dir).read({})).total).toBe(1400)
    await ledgerIn(dir).award({}, [
      { ...merged, kind: 'ci-green', id: 'ci-green:github#2@w', xp: 20 }
    ])
    expect((await ledgerIn(dir).read({})).total).toBe(1420)
    expect(JSON.parse(readFileSync(path, 'utf8')).later).toBe(1)
  })
})
