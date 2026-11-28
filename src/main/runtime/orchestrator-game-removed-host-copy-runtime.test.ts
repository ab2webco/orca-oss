import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const userData = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => userData.dir) }
}))

import type { Repo } from '../../shared/repo-types'
import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'
import type { GameMemberSessionStore } from './orchestrator-game-member-session-store'
import type { GameDroppedAgentStore } from './orchestrator-game-dropped-agent-store'

const LEAD = 'repo:repo-lead'
const LOCAL = JSON.stringify({ kind: 'local', hostId: 'local' })
const BOX = JSON.stringify({ kind: 'ssh', targetId: 'box' })

// Why the casts: the stores are private, and a repo removal reaches them only through removeProject.
type Internals = {
  gameMemberSessions: GameMemberSessionStore
  gameDroppedAgents: GameDroppedAgentStore
}

/** repo-1 on this machine and on ssh:box, as `repos:addForHost` registers the same id twice. */
function setup() {
  const repos = [
    { id: 'repo-lead', path: '/w/lead', displayName: 'Lead', executionHostId: 'local' },
    { id: 'repo-1', path: '/w/repo-1', displayName: 'App Local', executionHostId: 'local' },
    { id: 'repo-1', path: '/srv/repo-1', displayName: 'App Box', connectionId: 'box' }
  ] as Repo[]
  const hostOf = (repo: Repo) =>
    repo.executionHostId ?? (repo.connectionId ? `ssh:${repo.connectionId}` : 'local')
  const runtime = new OrcaRuntimeService({
    getRepos: () => [...repos],
    getRepo: (id: string) => repos.find((repo) => repo.id === id) ?? null,
    getAllWorktreeMeta: () => ({}),
    getWorktreeMeta: () => null,
    setWorktreeMeta: vi.fn(),
    removeWorktreeMeta: vi.fn(),
    getGitHubCache: () => null,
    removeProject: vi.fn(),
    removeProjectForHost: vi.fn((id: string, hostId: string) => {
      const index = repos.findIndex((repo) => repo.id === id && hostOf(repo) === hostId)
      repos.splice(index, 1)
    })
  } as never)
  const db = new OrchestrationDb(':memory:')
  runtime.setOrchestrationDb(db)
  const internals = runtime as unknown as Internals
  return { runtime, db, members: internals.gameMemberSessions, drops: internals.gameDroppedAgents }
}

/** A live member launched here, its terminal on `hostScope`, as worker-start records it. */
function liveWorker(db: OrchestrationDb, ticket: string, worktreeId: string, hostScope: string) {
  const task = db.createTask({ spec: ticket, taskTitle: `Merlin · ${ticket}` })
  const { dispatch } = db.createStartingWorkerDispatch({ taskId: task.id, startOptions: {} })
  db.prepareStartingWorkerAuthority({
    dispatchId: dispatch.id,
    handle: `term_${ticket}`,
    paneKey: `pane:${ticket}`,
    processIncarnation: `pty-${ticket}:1`,
    worktreeId,
    effects: [],
    setupState: 'not_applicable',
    hostScope,
    terminalOwnership: 'created'
  })
  db.markWorkerDispatchReady(dispatch.id)
  return dispatch.id
}

const stateOf = (db: OrchestrationDb, dispatchId: string) => ({
  worker: db.getWorkerDispatch(dispatchId)?.state,
  dispatch: db.getDispatchContextById(dispatchId)?.status
})
const LIVE = { worker: 'ready', dispatch: 'dispatched' }
const SETTLED = { worker: 'stopped', dispatch: 'failed' }

const save = (
  members: GameMemberSessionStore,
  ticket: string,
  worktreeId: string,
  dispatchId: string | null
) =>
  members.upsert(LEAD, { ticket, runId: 'run_1', taskId: `task_${ticket}`, worktreeId, dispatchId })

const savedOf = async (members: GameMemberSessionStore) => {
  const read = await members.read(LEAD)
  return read.ok ? read.members.map((one) => one.ticket) : read.reason
}
const dropped = async (drops: GameDroppedAgentStore) =>
  (await drops.read(LEAD)).map((one) => one.name)

describe('forgetting one host copy of a shared repo retires only that host members (ORCA-1491)', () => {
  let databases: OrchestrationDb[] = []

  beforeEach(() => {
    userData.dir = mkdtempSync(join(tmpdir(), 'orca-removed-host-copy-'))
  })

  afterEach(() => {
    for (const db of databases) {
      db.close()
    }
    databases = []
    rmSync(userData.dir, { recursive: true, force: true })
  })

  it('orca repo rm of the ssh:box copy settles and forgets the box member and keeps the local one live and saved', async () => {
    const { runtime, db, members, drops } = setup()
    databases.push(db)
    const local = liveWorker(db, 'ORCA-1', 'repo-1::/w/orca-1', LOCAL)
    const onBox = liveWorker(db, 'ORCA-2', 'repo-1::/srv/orca-2', BOX)
    await save(members, 'ORCA-1', 'repo-1::/w/orca-1', local)
    await save(members, 'ORCA-2', 'repo-1::/srv/orca-2', onBox)
    await drops.set(LEAD, { worktreeId: 'repo-1::/w/orca-1', environmentId: null, name: 'l' }, true)
    await drops.set(
      LEAD,
      { worktreeId: 'repo-1::/srv/orca-2', environmentId: null, name: 'b' },
      true
    )

    await runtime.removeProject('path:/srv/repo-1')

    expect(stateOf(db, onBox)).toEqual(SETTLED)
    expect(db.getDispatchContextById(onBox)?.last_failure).toBe('workspace_removed')
    expect(stateOf(db, local)).toEqual(LIVE)
    expect(await savedOf(members)).toEqual(['ORCA-1'])
    expect(await dropped(drops)).toEqual(['l'])
  })

  it('forgetting the local copy leaves the box member, even at a worktree id that reads the same', async () => {
    const { runtime, db, members, drops } = setup()
    databases.push(db)
    const local = liveWorker(db, 'ORCA-1', 'repo-1::/w/same', LOCAL)
    const onBox = liveWorker(db, 'ORCA-2', 'repo-1::/w/same', BOX)
    await save(members, 'ORCA-1', 'repo-1::/w/same', local)
    await save(members, 'ORCA-2', 'repo-1::/w/same', onBox)
    // Why kept: both hosts used this worktree id, so the drop cannot be told apart.
    await drops.set(LEAD, { worktreeId: 'repo-1::/w/same', environmentId: null, name: 's' }, true)

    await runtime.removeProject('name:App Local')

    expect(stateOf(db, local)).toEqual(SETTLED)
    expect(stateOf(db, onBox)).toEqual(LIVE)
    expect(await savedOf(members)).toEqual(['ORCA-2'])
    expect(await dropped(drops)).toEqual(['s'])
  })

  it('keeps a saved member whose host it cannot prove, and the lead project of the repo', async () => {
    const { runtime, db, members } = setup()
    databases.push(db)
    await save(members, 'ORCA-3', 'repo-1::/srv/orca-3', null)
    await members.upsert('repo:repo-1', { ticket: 'ORCA-4', runId: 'run_1', taskId: 'task_4' })

    const retired = await runtime.retireGameWorkspace({ repoId: 'repo-1', hostId: 'ssh:box' })

    expect(retired).toEqual({ settled: [], members: [], drops: 0, errors: [] })
    expect(await savedOf(members)).toEqual(['ORCA-3'])
    const own = await members.read('repo:repo-1')
    expect(own.ok && own.members.map((one) => one.ticket)).toEqual(['ORCA-4'])
  })
})
