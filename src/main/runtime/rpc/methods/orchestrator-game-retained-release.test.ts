import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from '../../../sqlite/sync-database'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameAgent, OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import { ORCHESTRATION_FEDERATION_RELEASE_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import { listRemoteGameMemberSources } from '../../orchestrator-game-remote-members'
import { releaseFederatedWorker } from './orchestration-federated-worker-release'
import { ORCHESTRATOR_GAME_METHODS } from './orchestrator-game'

const COORD_PANE = 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WORKTREE = 'repo::/home/m1/orca-774'

const lead: GameAgent = {
  paneKey: COORD_PANE,
  displayName: 'Lead',
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: true,
  terminalHandle: 'term_coord'
}

// Why: a lead released a member its host retained (someone typed in its terminal); once that
// terminal closed the row read 'Session closed' for good, since its worktree stayed (ORCA-1076).
describe('a remote member released while its host retained it', () => {
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let postEvent: ReturnType<typeof vi.fn>
  let calls: string[]
  let hostReleases: 'retained' | 'released'
  let hostAnswers: boolean

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    vi.spyOn(runtime, 'notifyMessageArrived').mockImplementation(() => {})
    postEvent = vi.fn().mockResolvedValue({ posted: true })
    vi.spyOn(runtime, 'getGameBoard').mockReturnValue({ postEvent } as never)
    vi.spyOn(runtime, 'resolveOrchestrationWorkerServer').mockReturnValue({
      environmentId: 'env_m1',
      name: 'm1',
      peerFingerprint: 'fp_m1'
    } as never)
    calls = []
    hostReleases = 'retained'
    hostAnswers = true
    vi.spyOn(runtime, 'callOrchestrationWorkerServer').mockImplementation(async (_env, method) => {
      calls.push(method)
      if (!hostAnswers) {
        throw new Error('host did not answer')
      }
      if (method === 'status.get') {
        return { capabilities: [ORCHESTRATION_FEDERATION_RELEASE_RUNTIME_CAPABILITY] }
      }
      if (method === 'orchestration.federationRelease') {
        return hostReleases === 'retained'
          ? {
              state: 'retained',
              reason: 'user_takeover',
              closedTerminals: [],
              removedWorktree: null
            }
          : { state: 'released', closedTerminals: [], removedWorktree: WORKTREE }
      }
      // The host still has its worktree, so the worker_done settle alone never fires.
      return method === 'orchestration.federationShow'
        ? {
            attachment: { effects: [{ kind: 'worktree', action: 'created', id: WORKTREE }] },
            observation: { status: 'gone' }
          }
        : { worktree: { id: WORKTREE } }
    })
  })

  afterEach(() => {
    db.close()
    vi.restoreAllMocks()
  })

  function remoteMember(): { runId: string; dispatchId: string } {
    const runId = db.createRun({
      objective: 'game',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: COORD_PANE
    }).id
    const task = db.createTask({ spec: 'ORCA-774', taskTitle: 'ORCA-774', runId })
    const { dispatch } = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { on: 'env_m1', serverName: 'm1' },
      federation: {
        environmentId: 'env_m1',
        environmentName: 'm1',
        peerFingerprint: 'fp_m1',
        protocolVersion: 1
      }
    })
    db.markWorkerDispatchReady(dispatch.id)
    db.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch.id,
      outcome: 'succeeded',
      result: 'done'
    })
    return { runId, dispatchId: dispatch.id }
  }

  const goneRow = (dispatchId: string): GameAgent => ({
    paneKey: `remote:${dispatchId}`,
    displayName: 'ORCA-774',
    agentType: 'codex',
    state: 'done',
    toolName: null,
    isLeader: false,
    isMember: true,
    remote: { host: 'm1', environmentId: 'env_m1', stateKnown: true, gone: true }
  })

  async function leadReads(member: GameAgent): Promise<void> {
    vi.spyOn(runtime, 'getOrchestratorGameState').mockResolvedValue({
      role: 'lead',
      agents: [lead, member]
    } as OrchestratorGameState)
    const method = ORCHESTRATOR_GAME_METHODS.find((one) => one.name === 'game.state')!
    await method.handler(method.params!.parse({ worktreeId: 'wt-lead', paneKey: COORD_PANE }), {
      runtime
    })
  }

  const release = (dispatchId: string) =>
    releaseFederatedWorker({
      runtime,
      federated: db.getFederatedDispatch(dispatchId)!,
      requestId: undefined
    })

  it('releases it on its host once its terminal is gone, and the row leaves', async () => {
    const { runId, dispatchId } = remoteMember()
    expect((await release(dispatchId)).state).toBe('retained')

    hostReleases = 'released'
    await leadReads(goneRow(dispatchId))

    await vi.waitFor(() => expect(db.getWorkerDispatch(dispatchId)?.stage).toBe('released'))
    expect(listRemoteGameMemberSources(db, runId)).toEqual([])
    expect(calls.filter((one) => one === 'orchestration.federationRelease')).toHaveLength(2)
    await vi.waitFor(() => expect(postEvent).toHaveBeenCalledTimes(1))
    expect(postEvent.mock.calls[0]?.[0]).toMatchObject({
      ticket: 'ORCA-774',
      text: 'Released: its terminal on m1 closed after you asked to release it.'
    })
  })

  it('never releases a member the lead did not ask to release', async () => {
    const { runId, dispatchId } = remoteMember()
    hostReleases = 'released'

    await leadReads(goneRow(dispatchId))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(calls).not.toContain('orchestration.federationRelease')
    expect(listRemoteGameMemberSources(db, runId).map((one) => one.dispatchId)).toEqual([
      dispatchId
    ])
  })

  it('asks a host that does not answer at most once per interval', async () => {
    const { runId, dispatchId } = remoteMember()
    await release(dispatchId)
    hostAnswers = false
    calls = []

    await leadReads(goneRow(dispatchId))
    await leadReads(goneRow(dispatchId))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(calls.filter((one) => one === 'status.get')).toHaveLength(1)
    expect(listRemoteGameMemberSources(db, runId).map((one) => one.dispatchId)).toEqual([
      dispatchId
    ])
  })
})

describe('the release request a lead made survives an upgrade from schema 38', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('adds the column to a v38 database and records the request', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-orch-v38-'))
    dirs.push(dir)
    const file = join(dir, 'orchestration.db')
    new OrchestrationDb(file).close()
    const raw = new Database(file)
    raw.exec('ALTER TABLE federated_dispatches DROP COLUMN release_requested_at')
    raw.pragma('user_version = 38')
    raw.close()

    const upgraded = new OrchestrationDb(file)
    upgraded.markFederatedReleaseRequested('ctx_1')
    expect(upgraded.isFederatedReleaseRequested('ctx_1')).toBe(false)
    upgraded.close()
    const columns = new Database(file)
      .prepare("SELECT name FROM pragma_table_info('federated_dispatches')")
      .all() as { name: string }[]
    expect(columns.map((one) => one.name)).toContain('release_requested_at')
  })
})
