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
    ).resolves.toEqual({ question: answered })
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
    ).rejects.toThrow(/No question oq_1 for your ticket reached this host/)
  })
})
