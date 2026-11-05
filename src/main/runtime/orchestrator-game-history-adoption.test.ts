import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { adoptGameProjectHistory } from './orchestrator-game-history-adoption'
import { GameHistoryStore } from './orchestrator-game-history-store'
import { GameLessonStore } from './orchestrator-game-lesson-store'
import { GameStopSwitch } from './orchestrator-game-stop-switch'
import type { GameHistoryRecord } from '../../shared/orchestrator-game-history'
import { gameLessonOf } from '../../shared/orchestrator-game-lessons'

const OLD = 'repo:8e9e530d-old'
const NEW = 'repo:b39e0bc5-new'

const fileNameOf = (key: string): string =>
  createHash('sha256').update(key).digest('hex').slice(0, 32)

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function userData() {
  const root = mkdtempSync(join(tmpdir(), 'orca-game-adopt-'))
  dirs.push(root)
  const dirOf = (name: string) => () => join(root, name)
  return {
    root,
    history: new GameHistoryStore(dirOf('orchestrator-game-history')),
    lessons: new GameLessonStore(dirOf('orchestrator-game-lessons')),
    stops: new GameStopSwitch(dirOf('orchestrator-game-stop'))
  }
}

const record = (ticket: string, endedAt: string): GameHistoryRecord => ({
  ticket,
  repo: 'orca-oss',
  branch: null,
  agent: 'claude',
  account: null,
  launchedAt: null,
  endedAt,
  outcome: 'merged',
  pr: `#${ticket.slice(5)} merged`,
  lastReport: null
})

const lesson = (count: number) => ({
  ...gameLessonOf({
    kind: 'achievement',
    project: 'orca-oss',
    ticket: 'ORCA-1',
    character: null,
    what: 'PR merged',
    evidence: null,
    at: '2026-10-20T10:00:00.000Z'
  }),
  count
})

function adopt(
  data: ReturnType<typeof userData>,
  overrides: Partial<Parameters<typeof adoptGameProjectHistory>[0]> = {}
) {
  return adoptGameProjectHistory({
    fromRepoId: OLD.slice('repo:'.length),
    toKey: NEW,
    repoExists: () => false,
    liveLeadOf: async () => null,
    liveMembersOf: async () => [],
    stores: data,
    ...overrides
  })
}

async function seed(data: ReturnType<typeof userData>) {
  await data.history.append(OLD, record('ORCA-701', '2026-10-20T10:00:00.000Z'), {
    key: 'mario',
    name: 'Mario'
  })
  await data.history.appendEvent(OLD, {
    at: '2026-10-20T10:00:00.000Z',
    kind: 'merged',
    ticket: 'ORCA-701',
    text: null,
    by: 'orca',
    key: 'merged:#701'
  })
  await data.lessons.record(OLD, lesson(43))
  await data.history.append(NEW, record('ORCA-1001', '2026-11-04T21:00:00.000Z'), {
    key: 'mario',
    name: 'Mario'
  })
  await data.lessons.record(NEW, lesson(2))
}

describe('adoptGameProjectHistory', () => {
  it("merges the orphaned key's history, events, characters and lessons into the current key", async () => {
    const data = userData()
    await seed(data)

    const result = await adopt(data)

    expect(result).toMatchObject({ history: { records: 1, events: 1 }, lessons: 1, stop: null })
    expect((await data.history.list(NEW)).map((one) => one.ticket)).toEqual([
      'ORCA-701',
      'ORCA-1001'
    ])
    expect((await data.history.events(NEW)).map((one) => one.ticket)).toEqual(['ORCA-701'])
    expect(await data.history.characters(NEW)).toMatchObject([
      { key: 'mario', tickets: 2, xp: 200 }
    ])
    expect((await data.lessons.list(NEW)).map((one) => one.count)).toEqual([45])
    expect(await data.history.list(OLD)).toEqual([])
  })

  it('adds nothing when run a second time', async () => {
    const data = userData()
    await seed(data)
    await adopt(data)

    expect(await adopt(data)).toMatchObject({ history: null, lessons: null, stop: null })
    expect(await data.history.list(NEW)).toHaveLength(2)
    expect(await data.history.characters(NEW)).toMatchObject([{ tickets: 2 }])
    expect((await data.lessons.list(NEW)).map((one) => one.count)).toEqual([45])
  })

  it('keeps the orphaned files beside the store instead of deleting them', async () => {
    const data = userData()
    await seed(data)
    await adopt(data)

    const kept = (name: string) =>
      readdirSync(join(data.root, name)).filter((one) => one.includes('.adopted-'))
    expect(kept('orchestrator-game-history')).toHaveLength(1)
    expect(kept('orchestrator-game-lessons')).toHaveLength(1)
  })

  it('carries a STOP the old key held, so adopting never lifts it', async () => {
    const data = userData()
    await data.stops.set(OLD, { since: '2026-11-04T20:00:00.000Z', by: 'lead' })

    expect((await adopt(data)).stop).toMatchObject({ since: '2026-11-04T20:00:00.000Z' })
    expect(await data.stops.read(NEW)).toMatchObject({ since: '2026-11-04T20:00:00.000Z' })
    expect(await data.stops.read(OLD)).toBeNull()
  })

  it('refuses, touching nothing, while a lead or member of the project is live', async () => {
    const data = userData()
    await seed(data)

    await expect(
      adopt(data, { liveLeadOf: async (key) => (key === NEW ? 'term_lead' : null) })
    ).rejects.toThrow(/lead of this project is live \(term_lead\)/)
    await expect(
      adopt(data, { liveMembersOf: async (key) => (key === OLD ? ['Mario'] : []) })
    ).rejects.toThrow(/Members of this project are live \(Mario\)/)
    expect(await data.history.list(OLD)).toHaveLength(1)
    expect(await data.history.list(NEW)).toHaveLength(1)
  })

  it('refuses a repo id that Orca still has, or the project its own', async () => {
    const data = userData()
    await seed(data)

    await expect(adopt(data, { repoExists: () => true })).rejects.toThrow(/still in Orca/)
    await expect(adopt(data, { toKey: OLD })).rejects.toThrow(/own repo id/)
    await expect(adopt(data, { toKey: 'no-project' })).rejects.toThrow(/Orca terminal/)
    expect(await data.history.list(OLD)).toHaveLength(1)
  })

  it('leaves a damaged orphaned history where it is', async () => {
    const data = userData()
    await data.history.append(NEW, record('ORCA-1001', '2026-11-04T21:00:00.000Z'))
    const dir = join(data.root, 'orchestrator-game-history')
    writeFileSync(join(dir, `${fileNameOf(OLD)}.json`), '{not json')
    const before = readdirSync(dir).toSorted()

    await expect(adopt(data)).rejects.toThrow(/cannot be read/)
    expect(readdirSync(dir).toSorted()).toEqual(before)
    expect(await data.history.list(NEW)).toHaveLength(1)
  })
})
