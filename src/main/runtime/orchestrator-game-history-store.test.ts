import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameHistoryStore } from './orchestrator-game-history-store'
import type { GameHistoryRecord } from '../../shared/orchestrator-game-history'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function store(): { store: GameHistoryStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-history-'))
  dirs.push(dir)
  return { store: new GameHistoryStore(() => dir), dir }
}

const record = (ticket: string): GameHistoryRecord => ({
  ticket,
  repo: 'cineco',
  branch: null,
  agent: 'claude',
  account: null,
  launchedAt: null,
  endedAt: '2026-10-16T10:00:00.000Z',
  outcome: 'stopped',
  pr: null,
  lastReport: null
})

describe('GameHistoryStore', () => {
  it('keeps each project apart and survives a new store on the same folder', async () => {
    const { store: first, dir } = store()
    await first.append('repo-a', record('CIN-1'))
    await first.append('repo-b', record('ENG-1'))

    const again = new GameHistoryStore(() => dir)
    expect((await again.list('repo-a')).map((one) => one.ticket)).toEqual(['CIN-1'])
    expect((await again.list('repo-b')).map((one) => one.ticket)).toEqual(['ENG-1'])
    expect(await again.list('repo-c')).toEqual([])
    expect(readdirSync(dir).every((name) => /^[0-9a-f]+\.json$/.test(name))).toBe(true)
  })

  it('loses no record when two writes race', async () => {
    const { store: history } = store()
    await Promise.all([
      history.append('repo-a', record('CIN-1')),
      history.append('repo-a', record('CIN-2'))
    ])
    expect((await history.list('repo-a')).map((one) => one.ticket)).toEqual(['CIN-1', 'CIN-2'])
  })

  it('reads a damaged file as empty and starts it over', async () => {
    const { store: history, dir } = store()
    await history.append('repo-a', record('CIN-1'))
    const [file] = readdirSync(dir)
    writeFileSync(join(dir, file as string), '{not json')

    expect(await history.list('repo-a')).toEqual([])
    await history.append('repo-a', record('CIN-2'))
    expect((await history.list('repo-a')).map((one) => one.ticket)).toEqual(['CIN-2'])
  })
})
