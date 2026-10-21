import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATION_METHODS } from './orchestration'
import { OrcaRuntimeService } from '../../orca-runtime'
import type Database from '../../../sqlite/sync-database'
import { LEGACY_RUN_ID, OrchestrationDb } from '../../orchestration/db'
import { createLegacyStorageCutoverFixture } from '../../orchestration/orchestration-legacy-storage-test-fixture'

const LEAD_HANDLE = 'term_726_lead'
const WORKER_HANDLE = 'term_726_worker'
const WORKER_PANE_KEY = 'tab_worker:66666666-6666-4666-8666-666666666666'

describe('orchestration.send from a sender with no active Dispatch (ORCA-726)', () => {
  let db: OrchestrationDb | undefined
  let tempDir: string | undefined

  afterEach(() => {
    vi.restoreAllMocks()
    db?.close()
    db = undefined
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  function openAdopted(): { adopted: OrchestrationDb; runtime: OrcaRuntimeService } {
    const created = createLegacyStorageCutoverFixture()
    tempDir = created.tempDir
    const adopted = new OrchestrationDb(created.fixture.dbPath)
    db = adopted
    expect(adopted.getLegacyAdoption()).toBeDefined()
    const runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(adopted)
    vi.spyOn(runtime, 'getTerminalPaneKey').mockReturnValue(null)
    return { adopted, runtime }
  }

  function createLeadRun(target: OrchestrationDb, paneSuffix: string) {
    return target.createRun({
      objective: `lead ${paneSuffix}`,
      coordinatorHandle: LEAD_HANDLE,
      coordinatorPaneKey: `tab_lead${paneSuffix}:77777777-7777-4777-8777-77777777777${paneSuffix}`
    })
  }

  function completedDispatch(target: OrchestrationDb, runId: string, handle = WORKER_HANDLE) {
    const task = target.createTask({ spec: 'work', runId })
    const dispatch = target.createDispatchContext(task.id, handle, WORKER_PANE_KEY)
    target.completeDispatch(dispatch.id)
    return dispatch
  }

  async function send(runtime: OrcaRuntimeService, params: Record<string, unknown>) {
    const method = ORCHESTRATION_METHODS.find((m) => m.name === 'orchestration.send')
    return method!.handler(params as never, { runtime })
  }

  function rowCount(target: OrchestrationDb, runId: string): number {
    const sqlite = (target as unknown as { db: Database.Database }).db
    const row = sqlite
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE run_id = ?')
      .get(runId) as { n: number }
    return row.n
  }

  function legacyRowCount(target: OrchestrationDb): number {
    return rowCount(target, LEGACY_RUN_ID)
  }

  it('routes trailing status mail to the Run of the sender latest Dispatch', async () => {
    const { adopted, runtime } = openAdopted()
    const older = createLeadRun(adopted, '1')
    completedDispatch(adopted, older.id)
    const latest = createLeadRun(adopted, '2')
    completedDispatch(adopted, latest.id)

    for (const subject of ['41 s after ctx_028ddbf112a7', '17 min after ctx_1e4ce481939e']) {
      const result = (await send(runtime, {
        from: WORKER_HANDLE,
        to: LEAD_HANDLE,
        subject,
        type: 'status'
      })) as { message: { run_id: string } }
      expect(result.message.run_id).toBe(latest.id)
    }
    expect(legacyRowCount(adopted)).toBe(0)
  })

  it('finds the latest Dispatch by pane key when the handle was reminted', async () => {
    const { adopted, runtime } = openAdopted()
    const lead = createLeadRun(adopted, '3')
    completedDispatch(adopted, lead.id, 'term_726_worker_before_remint')

    const result = (await send(runtime, {
      from: WORKER_HANDLE,
      senderPaneKey: WORKER_PANE_KEY,
      to: LEAD_HANDLE,
      subject: 'after remint'
    })) as { message: { run_id: string } }

    expect(result.message.run_id).toBe(lead.id)
  })

  it('files peer mail under the legacy Run when the latest Dispatch Run lost its coordinator', async () => {
    const { adopted, runtime } = openAdopted()
    const lead = createLeadRun(adopted, '4')
    completedDispatch(adopted, lead.id)
    // A new Run on the same coordinator pane unbinds the old one.
    adopted.createRun({
      objective: 'replacement',
      coordinatorHandle: LEAD_HANDLE,
      coordinatorPaneKey: lead.coordinator_pane_key as string
    })
    const before = rowCount(adopted, lead.id)

    const result = (await send(runtime, {
      from: WORKER_HANDLE,
      to: 'term_726_peer',
      subject: 'too late'
    })) as { message: { run_id: string } }

    expect(result.message.run_id).toBe(LEGACY_RUN_ID)
    expect(rowCount(adopted, lead.id)).toBe(before)
  })

  it('files mail from a never-dispatched sender under the Run its recipient coordinates', async () => {
    const { adopted, runtime } = openAdopted()
    const lead = createLeadRun(adopted, '5')

    const result = (await send(runtime, {
      from: 'term_726_stranger',
      to: LEAD_HANDLE,
      subject: 'ping the lead'
    })) as { message: { run_id: string } }

    expect(result.message.run_id).toBe(lead.id)
    expect(legacyRowCount(adopted)).toBe(0)
  })

  it('files peer mail from a never-dispatched sender under the legacy Run by name', async () => {
    const { adopted, runtime } = openAdopted()

    const result = (await send(runtime, {
      from: 'term_726_stranger',
      to: 'term_726_peer',
      subject: 'hello'
    })) as { message: { run_id: string; delivery_contract: string } }

    // Why: push-on-idle still points the recipient pane at it, as on main.
    expect(result.message).toMatchObject({
      run_id: LEGACY_RUN_ID,
      delivery_contract: 'current_delivery'
    })
    expect(legacyRowCount(adopted)).toBe(1)
  })
})
