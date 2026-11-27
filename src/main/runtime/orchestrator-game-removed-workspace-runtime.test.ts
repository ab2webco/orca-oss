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

import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'
import type { GameMemberSessionStore } from './orchestrator-game-member-session-store'
import type { GameDroppedAgentStore } from './orchestrator-game-dropped-agent-store'

const REPOS = [
  { id: 'repo-lead', path: '/w/lead' },
  { id: 'repo-1', path: '/w/repo-1' },
  { id: 'repo-10', path: '/w/repo-10' }
]
const LEAD = 'repo:repo-lead'

// Why the casts: the stores are private, and a desktop delete reaches them only through removal.
type Internals = {
  store: unknown
  gameMemberSessions: GameMemberSessionStore
  gameDroppedAgents: GameDroppedAgentStore
}

function setup(): {
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  members: GameMemberSessionStore
  drops: GameDroppedAgentStore
  removeFolderWorkspace: ReturnType<typeof vi.fn>
} {
  const runtime = new OrcaRuntimeService(null)
  const removeFolderWorkspace = vi.fn(() => true)
  const internals = runtime as unknown as Internals
  internals.store = {
    getRepos: () => REPOS,
    getRepo: (id: string) => REPOS.find((one) => one.id === id),
    removeFolderWorkspace
  }
  const db = new OrchestrationDb(':memory:')
  runtime.setOrchestrationDb(db)
  return {
    runtime,
    db,
    members: internals.gameMemberSessions,
    drops: internals.gameDroppedAgents,
    removeFolderWorkspace
  }
}

/** A live member launched here, as worker-start records it. */
function liveWorker(db: OrchestrationDb, ticket: string, worktreeId: string): string {
  const task = db.createTask({ spec: ticket, taskTitle: `Merlin · ${ticket}` })
  const { dispatch } = db.createStartingWorkerDispatch({ taskId: task.id, startOptions: {} })
  db.recordWorkerStage({ dispatchId: dispatch.id, stage: 'agent_started', worktreeId })
  db.markWorkerDispatchReady(dispatch.id)
  return dispatch.id
}

/** A member on a paired host whose worktree id reads the same as one here. */
function remoteWorker(db: OrchestrationDb, worktreeId: string): string {
  const task = db.createTask({ spec: 'ORCA-1' })
  const { dispatch } = db.createStartingWorkerDispatch({
    taskId: task.id,
    startOptions: { on: 'env_imac' },
    federation: {
      environmentId: 'env_imac',
      environmentName: 'imac',
      peerFingerprint: 'fp_imac',
      protocolVersion: 1
    }
  })
  db.recordWorkerStage({ dispatchId: dispatch.id, stage: 'agent_started', worktreeId })
  db.markWorkerDispatchReady(dispatch.id)
  return dispatch.id
}

const stateOf = (db: OrchestrationDb, dispatchId: string) => ({
  worker: db.getWorkerDispatch(dispatchId)?.state,
  dispatch: db.getDispatchContextById(dispatchId)?.status
})
const LIVE = { worker: 'ready', dispatch: 'dispatched' }
const SETTLED = { worker: 'stopped', dispatch: 'failed' }

async function saveMember(
  members: GameMemberSessionStore,
  key: string,
  ticket: string,
  worktreeId: string
): Promise<void> {
  await members.upsert(key, { ticket, runId: 'run_1', taskId: `task_${ticket}`, worktreeId })
}

const savedOf = async (members: GameMemberSessionStore, key: string) => {
  const read = await members.read(key)
  return read.ok ? read.members.map((one) => `${one.ticket} ${one.worktreeId}`) : read.reason
}

describe('deleting a workspace settles and forgets its members (ORCA-1478)', () => {
  let databases: OrchestrationDb[] = []

  beforeEach(() => {
    userData.dir = mkdtempSync(join(tmpdir(), 'orca-removed-workspace-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    for (const db of databases) {
      db.close()
    }
    databases = []
    rmSync(userData.dir, { recursive: true, force: true })
  })

  it('a deleted worktree settles its dispatch and forgets its record and drop, leaving the same ticket elsewhere', async () => {
    const { runtime, db, members, drops } = setup()
    databases.push(db)
    const removed = liveWorker(db, 'ORCA-1', 'repo-1::/w/orca-1')
    const sameTicket = liveWorker(db, 'ORCA-1', 'repo-1::/w/orca-1-again')
    const onImac = remoteWorker(db, 'repo-1::/w/orca-1')
    // Why the lead's project: a member is saved and dropped under its lead's repo, not its own.
    await saveMember(members, LEAD, 'ORCA-1', 'repo-1::/w/orca-1')
    await saveMember(members, LEAD, 'ORCA-2', 'repo-1::/w/orca-2')
    await drops.set(LEAD, { worktreeId: 'repo-1::/w/orca-1', environmentId: null, name: 'a' }, true)
    await drops.set(
      LEAD,
      { worktreeId: 'repo-1::/w/orca-1', environmentId: 'env_imac', name: 'b' },
      true
    )

    await runtime.noteIpcWorktreeLifecycle({
      kind: 'removed',
      worktreeId: 'repo-1::/w/orca-1',
      path: '/w/orca-1'
    })

    expect(stateOf(db, removed)).toEqual(SETTLED)
    expect(db.getDispatchContextById(removed)?.last_failure).toBe('workspace_removed')
    expect(stateOf(db, sameTicket)).toEqual(LIVE)
    expect(stateOf(db, onImac)).toEqual(LIVE)
    expect(await savedOf(members, LEAD)).toEqual(['ORCA-2 repo-1::/w/orca-2'])
    expect((await drops.read(LEAD)).map((one) => one.name)).toEqual(['b'])
  })

  it('a removed repo settles every worktree of it, empties its own project and leaves a repo whose id it prefixes', async () => {
    const { runtime, db, members, drops } = setup()
    databases.push(db)
    const first = liveWorker(db, 'ORCA-1', 'repo-1::/w/orca-1')
    const second = liveWorker(db, 'ORCA-2', 'repo-1::/w/orca-2')
    const otherRepo = liveWorker(db, 'ORCA-3', 'repo-10::/w/orca-3')
    await saveMember(members, 'repo:repo-1', 'ORCA-9', 'repo-lead::/w/orca-9')
    await saveMember(members, LEAD, 'ORCA-1', 'repo-1::/w/orca-1')
    await saveMember(members, LEAD, 'ORCA-3', 'repo-10::/w/orca-3')
    await drops.set('repo:repo-1', { worktreeId: 'x', environmentId: 'env_imac', name: 'c' }, true)

    const retired = await runtime.retireGameWorkspace({ repoId: 'repo-1' })

    expect(retired.settled.sort()).toEqual([first, second].sort())
    expect(stateOf(db, otherRepo)).toEqual(LIVE)
    expect(await savedOf(members, 'repo:repo-1')).toEqual([])
    expect(await savedOf(members, LEAD)).toEqual(['ORCA-3 repo-10::/w/orca-3'])
    expect(await drops.read('repo:repo-1')).toEqual([])
    expect(retired.errors).toEqual([])
  })

  it('blocks the Task of a settled member, as a stop does, instead of leaving it dispatched', async () => {
    const { runtime, db } = setup()
    databases.push(db)
    const removed = liveWorker(db, 'ORCA-5', 'repo-1::/w/orca-5')
    const taskId = db.getDispatchContextById(removed)!.task_id

    await runtime.retireGameWorkspace({ worktreeId: 'repo-1::/w/orca-5' })

    expect(db.getTask(taskId)?.status).toBe('blocked')
  })

  it('a deleted folder workspace settles and forgets the member that ran in it', async () => {
    const { runtime, db, members, removeFolderWorkspace } = setup()
    databases.push(db)
    const inFolder = liveWorker(db, 'ORCA-4', 'folder:fw-1')
    const otherFolder = liveWorker(db, 'ORCA-4', 'folder:fw-2')
    await saveMember(members, LEAD, 'ORCA-4', 'folder:fw-1')

    expect(await runtime.deleteFolderWorkspace('fw-1')).toEqual({ deleted: true })

    expect(removeFolderWorkspace).toHaveBeenCalledWith('fw-1')
    expect(stateOf(db, inFolder)).toEqual(SETTLED)
    expect(stateOf(db, otherFolder)).toEqual(LIVE)
    expect(await savedOf(members, LEAD)).toEqual([])
  })
})
