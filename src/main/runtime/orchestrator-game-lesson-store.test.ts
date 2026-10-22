import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GameLessonStore,
  GameLessons,
  type GameLessonMirror
} from './orchestrator-game-lesson-store'
import { EngramLessonMirror, type EngramRequest } from './orchestrator-game-lesson-engram'
import { gameLessonOf, type GameLessonSignal } from '../../shared/orchestrator-game-lessons'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-lessons-'))
  dirs.push(dir)
  return dir
}

const signal = (overrides: Partial<GameLessonSignal> = {}): GameLessonSignal => ({
  kind: 'failure',
  project: 'cineco',
  ticket: 'CIN-1',
  character: 'Mario',
  what: 'Member ended failed: CI red on #41 after a verified claim',
  evidence: '#41 open',
  at: '2026-10-20T10:00:00.000Z',
  ...overrides
})

const storeIn = (dir: string): GameLessonStore => new GameLessonStore(() => dir)

const PROJECT = { key: 'repo:a', name: 'cineco', directory: '/work/cineco' }

/** Engram's HTTP API as the lessons use it: sessions, topic-key upserts and search. */
function fakeEngram(): { request: EngramRequest; rows: Map<string, Record<string, unknown>> } {
  const rows = new Map<string, Record<string, unknown>>()
  const request: EngramRequest = async (path, body) => {
    if (path === '/sessions') {
      return { status: 'created' }
    }
    if (path === '/observations' && body && typeof body === 'object') {
      const row = body as Record<string, unknown>
      if (typeof row.session_id !== 'string') {
        throw new Error('session_id and content are required')
      }
      rows.set(`${String(row.project)}|${String(row.topic_key)}`, row)
      return { status: 'saved' }
    }
    const url = new URL(path, 'http://engram')
    if (url.pathname === '/search') {
      const project = url.searchParams.get('project')
      const query = url.searchParams.get('q') ?? ''
      return [...rows.values()].filter(
        (row) => row.project === project && String(row.content).includes(query)
      )
    }
    throw new Error(`unexpected ${path}`)
  }
  return { request, rows }
}

describe('GameLessonStore', () => {
  it('round-trips a lesson per project and survives a new store on the same folder', async () => {
    const dir = tempDir()
    await new GameLessonStore(() => dir).record('repo:a', gameLessonOf(signal()))
    await new GameLessonStore(() => dir).record('repo:b', gameLessonOf(signal({ project: 'b' })))
    const reread = new GameLessonStore(() => dir)
    expect(await reread.list('repo:a')).toEqual([gameLessonOf(signal())])
    expect((await reread.list('repo:b'))[0]?.project).toBe('b')
  })

  it('merges a repeat into one lesson whose count rises', async () => {
    const store = storeIn(tempDir())
    await store.record('repo:a', gameLessonOf(signal()))
    const merged = await store.record(
      'repo:a',
      gameLessonOf(
        signal({
          ticket: 'CIN-2',
          what: 'Member ended failed: CI red on #52 after a verified claim',
          at: '2026-10-21T10:00:00.000Z'
        })
      )
    )
    expect(merged).toMatchObject({ count: 2, ticket: 'CIN-2' })
    expect(await store.list('repo:a')).toHaveLength(1)
  })

  it('keeps two concurrent records of one project', async () => {
    const store = storeIn(tempDir())
    await Promise.all([
      store.record('repo:a', gameLessonOf(signal({ what: 'first outcome' }))),
      store.record('repo:a', gameLessonOf(signal({ what: 'second outcome' })))
    ])
    expect((await store.list('repo:a')).map((one) => one.what).toSorted()).toEqual([
      'first outcome',
      'second outcome'
    ])
  })

  it('sets a damaged file aside instead of failing the record', async () => {
    const dir = tempDir()
    const store = new GameLessonStore(() => dir)
    await store.record('repo:a', gameLessonOf(signal()))
    const [file] = readdirSync(dir)
    writeFileSync(join(dir, file ?? 'x.json'), '{not json')
    expect(await store.list('repo:a')).toEqual([])
    await store.record('repo:a', gameLessonOf(signal()))
    expect(await store.list('repo:a')).toHaveLength(1)
    expect(readdirSync(dir).some((name) => name.includes('.damaged-'))).toBe(true)
  })
})

describe('EngramLessonMirror', () => {
  it('round-trips the same lesson record through Engram, one row per fingerprint', async () => {
    const engram = fakeEngram()
    const mirror = new EngramLessonMirror(engram.request)
    const lesson = gameLessonOf(signal())
    await mirror.save(PROJECT, lesson)
    await mirror.save(PROJECT, { ...lesson, count: 2 })
    expect(engram.rows.size).toBe(1)
    expect(await mirror.list(PROJECT)).toEqual([{ ...lesson, count: 2 }])
    expect(await mirror.list({ ...PROJECT, name: 'other' })).toEqual([])
  })

  it('skips Engram rows that are not lessons or do not parse', async () => {
    const engram = fakeEngram()
    engram.rows.set('x', { project: 'cineco', topic_key: 'notes/1', content: 'orcalessonv1 {}' })
    engram.rows.set('y', {
      project: 'cineco',
      topic_key: 'orca-lesson/1',
      content: 'orcalessonv1 {bad'
    })
    expect(await new EngramLessonMirror(engram.request).list(PROJECT)).toEqual([])
  })

  it('stops asking a failing Engram for a while', async () => {
    let calls = 0
    const mirror = new EngramLessonMirror(async () => {
      calls += 1
      throw new Error('ECONNREFUSED')
    })
    await expect(mirror.list(PROJECT)).rejects.toThrow()
    await expect(mirror.list(PROJECT)).rejects.toThrow('Engram unavailable')
    expect(calls).toBe(1)
  })
})

describe('GameLessons', () => {
  it('records into the Orca store and mirrors the merged lesson to Engram', async () => {
    const engram = fakeEngram()
    const lessons = new GameLessons({
      store: storeIn(tempDir()),
      mirror: new EngramLessonMirror(engram.request)
    })
    await lessons.record(PROJECT, signal())
    await lessons.record(PROJECT, signal({ ticket: 'CIN-9' }))
    const [row] = [...engram.rows.values()]
    expect(String(row?.content)).toContain('"count":2')
    expect(await lessons.list(PROJECT)).toMatchObject([{ count: 2, ticket: 'CIN-9' }])
  })

  it('reads lessons from both stores through one schema', async () => {
    const engram = fakeEngram()
    const store = storeIn(tempDir())
    // Why: a lesson recorded before Engram was installed, and one only Engram holds.
    await store.record(PROJECT.key, gameLessonOf(signal({ what: 'orca only' })))
    await new EngramLessonMirror(engram.request).save(
      PROJECT,
      gameLessonOf(signal({ what: 'engram only' }))
    )
    const lessons = new GameLessons({ store, mirror: new EngramLessonMirror(engram.request) })
    expect((await lessons.list(PROJECT)).map((one) => one.what).toSorted()).toEqual([
      'engram only',
      'orca only'
    ])
  })

  it('keeps the lesson in the Orca store when Engram fails', async () => {
    const failing: GameLessonMirror = {
      save: async () => {
        throw new Error('timeout')
      },
      list: async () => {
        throw new Error('timeout')
      }
    }
    const lessons = new GameLessons({ store: storeIn(tempDir()), mirror: failing })
    await lessons.record(PROJECT, signal())
    expect(await lessons.list(PROJECT)).toHaveLength(1)
  })
})
