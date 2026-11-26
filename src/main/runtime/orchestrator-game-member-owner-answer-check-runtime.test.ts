import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const userData = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => userData.dir) }
}))

import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'

const dirs: string[] = []
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

const answered = {
  id: 'oq_1',
  ticket: 'CIN-1',
  question: 'Merge and deploy to production?',
  options: ['Yes', 'No'],
  context: null,
  askedAt: '2026-11-18T10:00:00.000Z',
  answer: { text: 'Yes', at: '2026-11-18T10:05:00.000Z', via: 'inbox' }
}

describe("a member on a paired host checks its lead host's owner answer (ORCA-1281)", () => {
  const databases: OrchestrationDb[] = []
  afterEach(() => {
    for (const database of databases.splice(0)) {
      database.close()
    }
    vi.restoreAllMocks()
  })

  function memberHost() {
    userData.dir = mkdtempSync(join(tmpdir(), 'orca-remote-owner-answers-'))
    dirs.push(userData.dir)
    const runtime = new OrcaRuntimeService(null)
    const db = new OrchestrationDb(':memory:')
    databases.push(db)
    runtime.setOrchestrationDb(db)
    db.createRemoteDispatchAttachment({
      dispatchId: 'ctx_member',
      taskId: 'task_member',
      homePeerFingerprint: 'fp_lead_host',
      protocolVersion: 3,
      runtimeEpoch: 'epoch',
      mutationReceipt: {
        callerFingerprint: 'fp_lead_host',
        requestId: 'request_member',
        method: 'orchestration.federationAttachStart',
        payloadHash: 'hash'
      }
    })
    db.prepareRemoteAttachmentAuthority({
      dispatchId: 'ctx_member',
      paneKey: 'tab-1:leaf-1',
      processIncarnation: 'proc-1',
      worktreeId: 'wt-member',
      terminalHandle: 'term_member',
      setupState: 'none',
      effects: []
    })
    vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === 'term_member' ? 'tab-1:leaf-1' : null
    )
    return runtime
  }

  it('reads the answer its lead host shared, by id, through the remote attachment', async () => {
    const runtime = memberHost()
    // Why the cast: the board's project lookup is private; a remote member must never reach it.
    const board = vi.spyOn(
      runtime as unknown as { gameBoardProjectOf: () => Promise<unknown> },
      'gameBoardProjectOf'
    )

    await runtime.keepGameOwnerAnswersFromLeadHost(
      { dispatchId: 'ctx_member', ticket: 'CIN-1', questions: [answered] },
      'fp_lead_host'
    )

    await expect(
      runtime.readGameOwnerQuestion({ terminalHandle: 'term_member', role: 'member', id: 'oq_1' })
    ).resolves.toEqual({ question: answered, sharedAt: expect.any(String) })
    expect(board).not.toHaveBeenCalled()
  })

  it('refuses a share from anyone but the paired lead host, so a member cannot write its own approval', async () => {
    const runtime = memberHost()

    await expect(
      runtime.keepGameOwnerAnswersFromLeadHost(
        { dispatchId: 'ctx_member', ticket: 'CIN-1', questions: [answered] },
        undefined
      )
    ).rejects.toThrow(/not found for this lead's host/)
    await expect(
      runtime.keepGameOwnerAnswersFromLeadHost(
        { dispatchId: 'ctx_member', ticket: 'CIN-1', questions: [answered] },
        'fp_someone_else'
      )
    ).rejects.toThrow(/not found for this lead's host/)
    await expect(
      runtime.readGameOwnerQuestion({ terminalHandle: 'term_member', role: 'member', id: 'oq_1' })
    ).rejects.toThrow(/cannot confirm oq_1: your lead's host has not shared/)
  })

  it('reads an unanswered question as current only after its lead host shared it (ORCA-1440)', async () => {
    const runtime = memberHost()
    const open = { ...answered, answer: null }

    await runtime.keepGameOwnerAnswersFromLeadHost(
      { dispatchId: 'ctx_member', ticket: 'CIN-1', questions: [open] },
      'fp_lead_host'
    )

    await expect(
      runtime.readGameOwnerQuestion({ terminalHandle: 'term_member', role: 'member', id: 'oq_1' })
    ).resolves.toEqual({ question: open, sharedAt: expect.any(String) })
  })
})

describe("a lead host shares a remote member's answers after a restart fenced its Run handle (ORCA-1440)", () => {
  const databases: OrchestrationDb[] = []
  afterEach(() => {
    for (const database of databases.splice(0)) {
      database.close()
    }
    vi.restoreAllMocks()
  })

  const answeredOnLead = { ...answered, id: 'oq_0893ebc4eb50', ticket: 'CIN-614' }

  async function leadHost() {
    userData.dir = mkdtempSync(join(tmpdir(), 'orca-lead-owner-answers-'))
    dirs.push(userData.dir)
    const runtime = new OrcaRuntimeService(null)
    const db = new OrchestrationDb(':memory:')
    databases.push(db)
    runtime.setOrchestrationDb(db)
    // Why a handle and pane nothing answers for: the lead runs on in a new pane after a restart.
    const run = db.createRun({
      objective: 'lead',
      coordinatorHandle: 'term_lead_before_restart',
      coordinatorPaneKey: 'tab-gone:leaf-gone'
    })
    const task = db.createTask({ spec: 'payments', taskTitle: 'CIN-614 payments', runId: run.id })
    const started = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { on: 'env_m1', serverName: 'm1', leadWorktreeId: 'repo-cin::/work/cineco' },
      federation: {
        environmentId: 'env_m1',
        environmentName: 'm1',
        peerFingerprint: 'fp_m1',
        protocolVersion: 3
      }
    })
    const worktrees = new Map([['repo-cin::/work/cineco', { repoId: 'repo-cin' }]])
    vi.spyOn(
      runtime as unknown as { getResolvedWorktreeMap: () => Promise<unknown> },
      'getResolvedWorktreeMap'
    ).mockResolvedValue(worktrees)
    // Why the cast: the lead's board file is private; `game answer-owner` writes it on a lead host.
    const history = Reflect.get(runtime, 'gameHistory') as {
      changeOwnerQuestions: (
        key: string,
        change: () => { list: unknown[]; result: null }
      ) => Promise<null>
    }
    await history.changeOwnerQuestions('repo:repo-cin', () => ({
      list: [answeredOnLead],
      result: null
    }))
    const send = vi.spyOn(runtime, 'callOrchestrationWorkerServer').mockResolvedValue({ kept: 1 })
    return { runtime, send, dispatchId: started.dispatch.id }
  }

  it("finds the lead's board by the worktree the launch recorded, not the fenced handle", async () => {
    const { runtime, send, dispatchId } = await leadHost()

    await runtime.shareGameOwnerAnswersWithRemoteMember(dispatchId)

    expect(send).toHaveBeenCalledWith(
      'env_m1',
      'game.ownerQuestionsImport',
      { dispatchId, ticket: 'CIN-614', questions: [answeredOnLead] },
      15_000
    )
  })
})
