import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameHistoryStore } from './orchestrator-game-history-store'
import type { GameHistoryRecord } from '../../shared/orchestrator-game-history'
import type { GameEvent } from '../../shared/orchestrator-game-events'
import type { GameStoreMigration } from '../../shared/orchestrator-game-store-migration'

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

  it('folds a freed member into its character and reads it back after a restart', async () => {
    const { store: first, dir } = store()
    await first.append(
      'repo-a',
      { ...record('CIN-1'), outcome: 'merged', pr: '#41 merged' },
      { key: 'arthur', name: 'Arthur' }
    )
    await first.append('repo-a', record('CIN-2'), { key: 'arthur', name: 'Arthur' })

    const again = new GameHistoryStore(() => dir)
    expect(await again.characters('repo-a')).toEqual([
      expect.objectContaining({
        key: 'arthur',
        tickets: 2,
        prsMerged: 1,
        outcomes: expect.objectContaining({ merged: 1, stopped: 1 }),
        xp: 100
      })
    ])
    expect(await again.characters('repo-b')).toEqual([])
  })

  it('counts a task once when the same member is recorded twice', async () => {
    const { store: history } = store()
    const arthur = { key: 'arthur', name: 'Arthur' }
    await Promise.all([
      history.append('repo-a', record('CIN-1'), arthur),
      history.append('repo-a', record('CIN-1'), arthur)
    ])

    expect((await history.characters('repo-a')).map((one) => one.tickets)).toEqual([1])
    expect(await history.list('repo-a')).toHaveLength(2)
  })

  it('reads a damaged file as empty, sets it aside, and starts it over', async () => {
    const { store: history, dir } = store()
    await history.append('repo-a', record('CIN-1'))
    const [file] = readdirSync(dir) as [string]
    writeFileSync(join(dir, file), '{not json')

    expect(await history.list('repo-a')).toEqual([])
    await history.append('repo-a', record('CIN-2'))
    expect((await history.list('repo-a')).map((one) => one.ticket)).toEqual(['CIN-2'])
    const aside = readdirSync(dir).filter((name) => name !== file)
    expect(aside).toHaveLength(1)
    expect(aside[0]).toMatch(new RegExp(`^${file.replace('.json', '')}\\.damaged-.+\\.json$`))
    expect(readFileSync(join(dir, aside[0] as string), 'utf8')).toBe('{not json')
  })
})

describe('GameHistoryStore across releases', () => {
  const fixture = readFileSync(
    join(__dirname, '__fixtures__', 'orchestrator-game-history-lab-104.json'),
    'utf8'
  )

  function seeded(migrations?: GameStoreMigration[]) {
    const { dir } = store()
    return { history: new GameHistoryStore(() => dir, migrations), dir }
  }
  const isMain = (name: string): boolean => /^[0-9a-f]+\.json$/.test(name)
  async function seed(dir: string, projectKey: string, text: string): Promise<string> {
    // Why through the store: the file name is the store's own hash of the project key.
    await new GameHistoryStore(() => dir).markInboxRead(projectKey, 'seed', 1)
    const name = readdirSync(dir).find(isMain) as string
    writeFileSync(join(dir, name), text)
    return join(dir, name)
  }

  it('reads lab.104 data as it was and keeps all of it on the first write', async () => {
    const { history, dir } = seeded()
    const file = await seed(dir, 'repo:cineco', fixture)

    expect((await history.list('repo:cineco')).map((one) => one.ticket)).toEqual([
      'CIN-12',
      'CIN-13'
    ])
    expect((await history.events('repo:cineco')).map((one) => one.kind)).toEqual([
      'claimed',
      'merged'
    ])
    expect(await history.cursors('repo:cineco')).toEqual({ lead: 42, 'CIN-12': 7 })
    expect(readFileSync(file, 'utf8')).toBe(fixture)

    await history.append('repo:cineco', record('CIN-14'))
    const written = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const before = JSON.parse(fixture) as Record<string, unknown[]>
    expect(written).toEqual({
      ...before,
      records: [...(before.records as unknown[]), record('CIN-14')],
      schemaVersion: 1
    })
    expect(readdirSync(dir).filter((name) => !isMain(name))).toEqual([])
  })

  it('keeps what a newer build added when this build rewrites the file', async () => {
    const { history, dir } = seeded()
    const newer = {
      schemaVersion: 1,
      streaks: { 'CIN-12': 3 },
      records: [
        { ...record('CIN-20'), score: 9 },
        { ...record('CIN-21'), outcome: 'abandoned' }
      ],
      events: [{ at: '2026-10-20T10:00:00.000Z', kind: 'leveled_up', ticket: null, by: 'orca' }],
      cursors: { lead: 3, 'CIN-21': 'opaque' }
    }
    const file = await seed(dir, 'repo-a', JSON.stringify(newer))

    expect((await history.list('repo-a')).map((one) => one.ticket)).toEqual(['CIN-20'])
    expect(await history.events('repo-a')).toEqual([])
    await history.markInboxRead('repo-a', 'lead', 9)

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      ...newer,
      cursors: { 'CIN-21': 'opaque', lead: 9 }
    })
  })

  it('never reshapes a store a newer build wrote, and still records into it', async () => {
    const { history, dir } = seeded([(data) => ({ ...data, reshaped: true })])
    const newer = { schemaVersion: 7, records: [], events: [], cursors: {}, ledger: [1, 2] }
    const file = await seed(dir, 'repo-a', JSON.stringify(newer))

    await history.append('repo-a', record('CIN-1'))
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ ...newer, records: [record('CIN-1')] })
    expect(readdirSync(dir).filter((name) => !isMain(name))).toEqual([])
  })

  it('never writes over a newer build whose lists are no longer lists', async () => {
    const { history, dir } = seeded()
    const newer = { schemaVersion: 2, records: { 'CIN-1': record('CIN-1') }, events: [] }
    const file = await seed(dir, 'repo-a', JSON.stringify(newer))

    expect(await history.list('repo-a')).toEqual([])
    await history.append('repo-a', record('CIN-2'))
    await history.markInboxRead('repo-a', 'lead', 4)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(newer)
  })

  it('backs the file up before it persists a migrated shape, and migrates once', async () => {
    const step: GameStoreMigration = (data) => ({ ...data, migratedFrom104: true })
    const { history, dir } = seeded([step])
    const file = await seed(dir, 'repo:cineco', fixture)

    expect((await history.list('repo:cineco')).map((one) => one.ticket)).toHaveLength(2)
    expect(readFileSync(file, 'utf8')).toBe(fixture)

    await history.append('repo:cineco', record('CIN-14'))
    const backups = readdirSync(dir).filter((name) => !isMain(name))
    expect(backups).toHaveLength(1)
    expect(backups[0]).toMatch(/^[0-9a-f]+\.v1-.+\.backup\.json$/)
    expect(readFileSync(join(dir, backups[0] as string), 'utf8')).toBe(fixture)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
      schemaVersion: 2,
      migratedFrom104: true
    })

    await new GameHistoryStore(() => dir, [step]).append('repo:cineco', record('CIN-15'))
    expect(readdirSync(dir).filter((name) => !isMain(name))).toHaveLength(1)
  })

  it('keeps the old data usable when a migration step throws', async () => {
    const broken: GameStoreMigration = () => {
      throw new Error('bad step')
    }
    const { history, dir } = seeded([broken])
    const file = await seed(dir, 'repo:cineco', fixture)

    expect((await history.list('repo:cineco')).map((one) => one.ticket)).toEqual([
      'CIN-12',
      'CIN-13'
    ])
    await history.append('repo:cineco', record('CIN-14'))
    const written = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    expect(written.schemaVersion).toBeUndefined()
    expect((written.records as unknown[]).length).toBe(3)
  })
})

describe('GameHistoryStore events', () => {
  const event = (ticket: string, kind: GameEvent['kind'], key?: string): GameEvent => ({
    at: '2026-10-16T10:00:00.000Z',
    kind,
    ticket,
    text: null,
    by: 'lead',
    ...(key ? { key } : {})
  })

  it("keeps a project's events next to its history, without touching either", async () => {
    const { store: first, dir } = store()
    await first.append('repo-a', record('CIN-1'))
    await first.appendEvent('repo-a', event('CIN-1', 'claimed'))
    await first.appendEvent('repo-b', event('ENG-1', 'failed'))

    const again = new GameHistoryStore(() => dir)
    expect((await again.list('repo-a')).map((one) => one.ticket)).toEqual(['CIN-1'])
    expect((await again.events('repo-a')).map((one) => one.kind)).toEqual(['claimed'])
    expect((await again.events('repo-b')).map((one) => one.ticket)).toEqual(['ENG-1'])
    await again.append('repo-a', record('CIN-2'))
    expect((await again.events('repo-a')).map((one) => one.kind)).toEqual(['claimed'])
  })

  it('loses no event when writes race and keeps a keyed one once', async () => {
    const { store: history } = store()
    const results = await Promise.all([
      history.appendEvent('repo-a', event('CIN-1', 'merged', 'merged CIN-1')),
      history.appendEvent('repo-a', event('CIN-1', 'merged', 'merged CIN-1')),
      history.appendEvent('repo-a', event('CIN-2', 'claimed')),
      history.append('repo-a', record('CIN-3'))
    ])
    expect(results.slice(0, 2).map((one) => (one as { added: boolean }).added)).toEqual([
      true,
      false
    ])
    expect((await history.events('repo-a')).map((one) => one.ticket)).toEqual(['CIN-1', 'CIN-2'])
    expect((await history.list('repo-a')).map((one) => one.ticket)).toEqual(['CIN-3'])
  })
})

describe('GameHistoryStore inbox cursors', () => {
  it('moves each inbox cursor forward only, next to the history and events', async () => {
    const { store: first, dir } = store()
    await first.append('repo-a', record('CIN-1'))
    await first.markInboxRead('repo-a', 'lead', 7)
    await first.markInboxRead('repo-a', 'lead', 3)
    await first.markInboxRead('repo-a', 'CIN-1', 2)

    const again = new GameHistoryStore(() => dir)
    expect(await again.cursors('repo-a')).toEqual({ lead: 7, 'CIN-1': 2 })
    expect(await again.cursors('repo-b')).toEqual({})
    expect((await again.list('repo-a')).map((one) => one.ticket)).toEqual(['CIN-1'])
  })
})

describe('GameHistoryStore owner questions', () => {
  it('keeps them per project next to the history, and loses none when writes race', async () => {
    const { store: first, dir } = store()
    await first.append('repo-a', record('CIN-1'))
    await Promise.all(
      ['oq_1', 'oq_2', 'oq_3'].map((id) =>
        first.changeOwnerQuestions('repo-a', (list) => ({ list: [...list, { id }], result: id }))
      )
    )
    const unchanged = await first.changeOwnerQuestions('repo-a', () => ({
      list: null,
      result: 'kept'
    }))

    const again = new GameHistoryStore(() => dir)
    expect(unchanged).toBe('kept')
    expect(await again.ownerQuestions('repo-a')).toEqual([
      { id: 'oq_1' },
      { id: 'oq_2' },
      { id: 'oq_3' }
    ])
    expect(await again.ownerQuestions('repo-b')).toEqual([])
    expect((await again.list('repo-a')).map((one) => one.ticket)).toEqual(['CIN-1'])
  })
})
