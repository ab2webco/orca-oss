import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameLeadRoster, type GameLeadRecord } from './orchestrator-game-lead-roster'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function roster(): { store: GameLeadRoster; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-roster-'))
  dirs.push(dir)
  return { store: new GameLeadRoster(() => join(dir, 'leads')), dir }
}

const RECORD: GameLeadRecord = {
  projectKey: 'repo:a',
  project: 'cineco',
  paneKey: 'tab-1:leaf-1',
  label: 'Ana',
  at: '2026-10-17T10:00:00.000Z',
  sessionId: 'sess-1'
}

describe('GameLeadRoster', () => {
  it('keeps the registered leads across a restart of the store', async () => {
    const { store, dir } = roster()
    expect(await store.read()).toEqual([])

    await store.write([RECORD, { ...RECORD, projectKey: 'repo:b', sessionId: null }])

    const reopened = new GameLeadRoster(() => join(dir, 'leads'))
    expect(await reopened.read()).toEqual([
      RECORD,
      { ...RECORD, projectKey: 'repo:b', sessionId: null }
    ])
  })

  it('reads a damaged file, or one another build wrote, as no leads', async () => {
    const { store, dir } = roster()
    mkdirSync(join(dir, 'leads'), { recursive: true })
    const file = join(dir, 'leads', 'live-leads.json')

    writeFileSync(file, '{not json')
    expect(await store.read()).toEqual([])

    writeFileSync(file, JSON.stringify({ version: 2, leads: [RECORD] }))
    expect(await store.read()).toEqual([])
  })

  it('skips a malformed record and keeps the others', async () => {
    const { store, dir } = roster()
    mkdirSync(join(dir, 'leads'), { recursive: true })
    writeFileSync(
      join(dir, 'leads', 'live-leads.json'),
      JSON.stringify({ version: 1, leads: [{ ...RECORD, paneKey: 7 }, RECORD] })
    )

    expect(await store.read()).toEqual([RECORD])
  })
})
