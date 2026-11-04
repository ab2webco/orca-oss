import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameDroppedAgentStore } from './orchestrator-game-dropped-agent-store'
import { GameHistoryStore, GAME_HISTORY_MIGRATIONS } from './orchestrator-game-history-store'
import { GameLeadSessions } from './orchestrator-game-lead-sessions'
import { GameLessonStore } from './orchestrator-game-lesson-store'
import { GameMemberSessionStore } from './orchestrator-game-member-session-store'
import { GameStopSwitch } from './orchestrator-game-stop-switch'
import { GameStoreNames, type GameRepoPlace } from './orchestrator-game-store-names'
import type { GameHistoryRecord } from '../../shared/orchestrator-game-history'
import { gameLessonOf } from '../../shared/orchestrator-game-lessons'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** A userData whose repos the test adds and removes, as Orca's repo store would. */
function userData() {
  const root = mkdtempSync(join(tmpdir(), 'orca-game-names-'))
  dirs.push(root)
  const repos = new Map<string, GameRepoPlace>()
  const names = new GameStoreNames((id) => repos.get(id) ?? null)
  const dirOf = (name: string) => () => join(root, name)
  return {
    root,
    repos,
    history: new GameHistoryStore(dirOf('history'), GAME_HISTORY_MIGRATIONS, names),
    lessons: new GameLessonStore(dirOf('lessons'), names),
    members: new GameMemberSessionStore(dirOf('members'), undefined, names),
    dropped: new GameDroppedAgentStore(dirOf('dropped'), undefined, names),
    leads: new GameLeadSessions(dirOf('leads'), names),
    stops: new GameStopSwitch(dirOf('stop'), names),
    /** The same folders read by a build from before the stable names. */
    legacyHistory: new GameHistoryStore(dirOf('history'))
  }
}

const record = (ticket: string): GameHistoryRecord => ({
  ticket,
  repo: 'orca-oss',
  branch: null,
  agent: 'claude',
  account: null,
  launchedAt: null,
  endedAt: '2026-11-04T20:00:00.000Z',
  outcome: 'merged',
  pr: null,
  lastReport: null
})

const local = (path: string): GameRepoPlace => ({ connectionId: null, path })

describe('GameStoreNames', () => {
  it('keeps every store of a repo removed and added again at the same path', async () => {
    const data = userData()
    data.repos.set('old', local('/src/orca-oss'))
    await data.history.append('repo:old', record('ORCA-701'))
    await data.lessons.record(
      'repo:old',
      gameLessonOf({
        kind: 'achievement',
        project: 'orca-oss',
        ticket: 'ORCA-701',
        character: null,
        what: 'PR merged',
        evidence: null,
        at: '2026-11-04T20:00:00.000Z'
      })
    )
    await data.members.upsert('repo:old', {
      ticket: 'ORCA-702',
      name: 'Mario',
      taskId: 'task_1',
      runId: 'run_1'
    })
    await data.dropped.set(
      'repo:old',
      { name: 'Luigi', worktreeId: 'wt', environmentId: null },
      true
    )
    await data.leads.write('repo:old', {
      sessionId: 's1',
      agentArgs: null,
      worktreeId: 'wt',
      accountId: null
    })
    await data.stops.set('repo:old', { since: '2026-11-04T20:00:00.000Z', by: 'lead' })

    data.repos.delete('old')
    data.repos.set('new', local('/src/orca-oss/'))

    expect((await data.history.list('repo:new')).map((one) => one.ticket)).toEqual(['ORCA-701'])
    expect(await data.lessons.list('repo:new')).toHaveLength(1)
    expect(await data.members.read('repo:new')).toMatchObject({
      ok: true,
      members: [{ ticket: 'ORCA-702' }]
    })
    expect(await data.dropped.read('repo:new')).toHaveLength(1)
    expect(await data.leads.read('repo:new')).toMatchObject({ sessionId: 's1' })
    expect(await data.stops.read('repo:new')).toMatchObject({ since: '2026-11-04T20:00:00.000Z' })
  })

  it('adopts a file kept under the repo id on first read, and leaves it for an older build', async () => {
    const data = userData()
    await data.legacyHistory.append('repo:a', record('ORCA-1'))
    data.repos.set('a', local('/src/orca-oss'))

    expect((await data.history.list('repo:a')).map((one) => one.ticket)).toEqual(['ORCA-1'])
    await data.history.append('repo:a', record('ORCA-2'))
    expect(readdirSync(join(data.root, 'history'))).toHaveLength(2)
    expect((await data.legacyHistory.list('repo:a')).map((one) => one.ticket)).toEqual(['ORCA-1'])
  })

  it('keeps an SSH repo apart from a local one at the same path, and two clones apart', async () => {
    const data = userData()
    data.repos.set('local', local('/src/orca-oss'))
    data.repos.set('ssh', { connectionId: 'ssh-imac', path: '/src/orca-oss' })
    data.repos.set('clone', local('/src/orca-oss-2'))
    await data.history.append('repo:ssh', record('ORCA-SSH'))

    expect(await data.history.list('repo:local')).toEqual([])
    expect(await data.history.list('repo:clone')).toEqual([])
    data.repos.delete('ssh')
    data.repos.set('ssh-again', { connectionId: 'ssh-imac', path: '/src/orca-oss' })
    expect((await data.history.list('repo:ssh-again')).map((one) => one.ticket)).toEqual([
      'ORCA-SSH'
    ])
  })

  it('names a folder workspace by its path too', async () => {
    const data = userData()
    data.repos.set('folder', local('/Users/me/notes'))
    await data.stops.set('repo:folder', { since: '2026-11-04T20:00:00.000Z', by: 'lead' })
    data.repos.delete('folder')
    data.repos.set('folder-again', local('/Users/me/notes'))

    expect(await data.stops.read('repo:folder-again')).not.toBeNull()
  })

  it("reads a repo id Orca no longer has under the id's own name, where adopt-history finds it", async () => {
    const data = userData()
    await data.legacyHistory.append('repo:gone', record('ORCA-9'))

    expect((await data.history.list('repo:gone')).map((one) => one.ticket)).toEqual(['ORCA-9'])
    expect((await data.history.list('no-project')).length).toBe(0)
  })
})
