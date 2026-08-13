import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import {
  ensureTerminalVisible,
  getActiveTabId,
  switchToOtherWorktree,
  switchToWorktree,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import {
  authorityLedgerPath,
  disposeWorkerRestartFixture,
  fakeCliDir,
  hasPersistedResumeRecord,
  interruptionLedgerPath,
  isProcessAlive,
  lifecycleLedgerPath,
  PROVIDER_SESSION_ID,
  readLedger,
  resetWorkerRestartLedgers,
  spawnLedgerPath,
  stripLegacyWorkerRendererBinding
} from './orchestration-worker-restart-fixture'
import { RuntimeClient } from '../../src/cli/runtime-client'
import Database from '../../src/main/sqlite/sync-database'
import {
  CURRENT_CONTRACT_VERSION,
  LEGACY_CONTRACT_VERSION,
  LEGACY_RUN_ID
} from '../../src/main/runtime/orchestration/db'
import type { RuntimeTerminalListResult, RuntimeTerminalRead } from '../../src/shared/runtime-types'
import { listAllOrchestrationRuns } from './orchestration-run-pages'

async function readRendererRecoveryState(
  page: Page,
  paneKey: string,
  tabId: string
): Promise<{ sleeping: boolean; resumeClaim: boolean; pendingStartup: boolean }> {
  return page.evaluate(
    ({ workerPaneKey, workerTabId }) => {
      const state = window.__store?.getState()
      return {
        sleeping: Boolean(state?.sleepingAgentSessionsByPaneKey[workerPaneKey]),
        resumeClaim: Boolean(state?.automaticAgentResumeClaimsByTabId[workerTabId]),
        pendingStartup: Boolean(state?.pendingStartupByTabId[workerTabId])
      }
    },
    { workerPaneKey: paneKey, workerTabId: tabId }
  )
}

function assertDispatchRemainsCurrent(
  userDataDir: string,
  input: {
    dispatchId: string
    terminalHandle: string
    paneKey: string
    processIncarnation: string
    worktreeId: string
  }
): void {
  const db = new Database(path.join(userDataDir, 'orchestration.db'))
  try {
    const authority = db
      .prepare(
        `SELECT dc.status AS dispatch_status, dc.assignee_handle, dc.assignee_pane_key,
                dc.process_incarnation, dc.contract_version, dc.capability_hash,
                wd.state AS worker_state, wd.worktree_id, wd.agent_terminal_handle
         FROM dispatch_contexts dc
         INNER JOIN worker_dispatches wd ON wd.dispatch_id = dc.id
         WHERE dc.id = ?`
      )
      .get(input.dispatchId)
    expect(authority).toEqual({
      dispatch_status: 'dispatched',
      assignee_handle: input.terminalHandle,
      assignee_pane_key: input.paneKey,
      process_incarnation: input.processIncarnation,
      contract_version: CURRENT_CONTRACT_VERSION,
      capability_hash: expect.any(String),
      worker_state: 'ready',
      worktree_id: input.worktreeId,
      agent_terminal_handle: input.terminalHandle
    })
  } finally {
    db.close()
  }
}

function markAssignmentAsPreUpdateLegacy(
  userDataDir: string,
  input: {
    taskId: string
    dispatchId: string
    terminalHandle: string
    paneKey: string
    processIncarnation: string
    worktreeId: string
  }
): void {
  const db = new Database(path.join(userDataDir, 'orchestration.db'))
  try {
    const authority = db
      .prepare(
        `SELECT dc.status AS dispatch_status, dc.assignee_handle, dc.assignee_pane_key,
                dc.process_incarnation, wd.state AS worker_state, wd.worktree_id,
                wd.agent_terminal_handle
         FROM dispatch_contexts dc
         INNER JOIN worker_dispatches wd ON wd.dispatch_id = dc.id
         WHERE dc.id = ?`
      )
      .get(input.dispatchId)
    expect(authority).toEqual({
      dispatch_status: 'dispatched',
      assignee_handle: input.terminalHandle,
      assignee_pane_key: input.paneKey,
      process_incarnation: input.processIncarnation,
      worker_state: 'ready',
      worktree_id: input.worktreeId,
      agent_terminal_handle: input.terminalHandle
    })
    db.exec('BEGIN IMMEDIATE')
    db.prepare('UPDATE tasks SET run_id = ? WHERE id = ?').run(LEGACY_RUN_ID, input.taskId)
    db.prepare(
      `UPDATE dispatch_contexts
       SET run_id = ?, contract_version = ?, capability_hash = NULL,
           capability_revoked_at = NULL, launch_token_hash = NULL
       WHERE id = ?`
    ).run(LEGACY_RUN_ID, LEGACY_CONTRACT_VERSION, input.dispatchId)
    db.exec(`
      DROP INDEX IF EXISTS idx_messages_delivery_contract;
      DROP TABLE legacy_mail_receipts;
      DROP TABLE legacy_operation_receipts;
      DROP TABLE legacy_compatibility_principals;
      DROP TABLE legacy_adoptions;
    `)
    db.pragma('user_version = 18')
    db.exec('COMMIT')
  } finally {
    db.close()
  }
}

test.describe.configure({ mode: 'serial' })

test.afterAll(() => {
  disposeWorkerRestartFixture()
})

for (const contractVersion of [LEGACY_CONTRACT_VERSION, CURRENT_CONTRACT_VERSION]) {
  const contractLabel = contractVersion === LEGACY_CONTRACT_VERSION ? 'legacy' : 'current'
  // Why fixme and not a repair: the `ACK` this waits for was never written by the fake
  // Codex. What satisfied it was the tty echo of the preamble Orca pastes, which
  // contains the task spec text — so the assertion passed only in the runs where the
  // prompt never reached the agent, and failed in the runs where it did. Measured over
  // 8 rounds with an instrumented fake: 5 pass with 0 bytes delivered, 3 fail with all
  // 5975 bytes delivered and answered. The two product defects it stumbled into ship
  // outside this sync (ORCA-208 delivery race, ORCA-209 agent output missing from the
  // read buffer); the oracle itself is ORCA-207. Running it here would only re-assert
  // something false.
  test.fixme(`adopts one live ${contractLabel} worker after restart without replaying resume`, async (// oxlint-disable-next-line no-empty-pattern -- This lifecycle test owns both Electron launches and intentionally opts out of the default app fixture.
  {}, testInfo) => {
    test.setTimeout(300_000)
    resetWorkerRestartLedgers()
    const repoPath = existsSync(TEST_REPO_PATH_FILE)
      ? readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
      : ''
    test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

    const session = createRestartSession(testInfo, {
      PATH: `${fakeCliDir}${path.delimiter}${process.env.PATH ?? ''}`,
      ORCA_E2E_SPAWN_LEDGER: spawnLedgerPath,
      ORCA_E2E_INTERRUPTION_LEDGER: interruptionLedgerPath,
      ORCA_E2E_AUTHORITY_LEDGER: authorityLedgerPath,
      ORCA_E2E_LIFECYCLE_LEDGER: lifecycleLedgerPath,
      ORCA_E2E_CLI_ENTRY: path.join(process.cwd(), 'out', 'cli', 'index.js')
    })
    let firstApp: ElectronApplication | null = null
    let secondApp: ElectronApplication | null = null

    try {
      const first = await session.launch()
      firstApp = first.app
      const worktreeId = await attachRepoAndOpenTerminal(first.page, repoPath)
      await waitForSessionReady(first.page)
      await ensureTerminalVisible(first.page)
      const coordinatorTabId = await getActiveTabId(first.page)
      expect(coordinatorTabId).toBeTruthy()
      await waitForActivePanePtyId(first.page)
      const coordinatorPane = await waitForActivePaneHookDescriptor(first.page)
      const firstClient = new RuntimeClient(session.userDataDir, 30_000, null, null)
      const coordinator = await firstClient.call<{ terminal: { handle: string } }>(
        'terminal.resolvePane',
        { paneKey: coordinatorPane.paneKey }
      )
      const coordinatorTerminal = await firstClient.call<{
        terminal: { worktreeId: string }
      }>('terminal.show', { terminal: coordinator.result.terminal.handle })
      await expect
        .poll(async () => {
          const listed = await firstClient.call<{ worktrees: { id: string }[] }>(
            'worktree.list',
            {}
          )
          return listed.result.worktrees.some(
            (candidate) => candidate.id === coordinatorTerminal.result.terminal.worktreeId
          )
        })
        .toBe(true)
      const run = await firstClient.call<{ run: { id: string } }>('orchestration.runCreate', {
        objective: 'Legacy worker restart recovery',
        from: coordinator.result.terminal.handle
      })
      const task = await firstClient.call<{ task: { id: string } }>('orchestration.taskCreate', {
        spec: 'Respond ACK and remain idle',
        run: run.result.run.id,
        callerTerminalHandle: coordinator.result.terminal.handle
      })
      const started = await firstClient.call<{
        effects: { kind: string; role?: string; id?: string }[]
      }>('orchestration.workerStart', {
        task: task.result.task.id,
        from: coordinator.result.terminal.handle,
        agent: 'codex',
        timeoutMs: 15_000
      })
      const workerHandle = started.result.effects.find(
        (effect) => effect.kind === 'terminal' && effect.role === 'agent'
      )?.id
      expect(workerHandle).toBeTruthy()

      let worker = (
        await firstClient.call<RuntimeTerminalListResult>('terminal.list')
      ).result.terminals.find((terminal) => terminal.title === 'Codex Ready')
      await expect
        .poll(async () => {
          const listed = await firstClient.call<RuntimeTerminalListResult>('terminal.list')
          worker = listed.result.terminals.find((terminal) => terminal.title === 'Codex Ready')
          return worker?.ptyId ?? null
        })
        .toBeTruthy()
      expect(worker?.incarnationId).toBeTruthy()
      const workerPaneKey = `${worker!.tabId}:${worker!.leafId}`
      // Why a distinct marker: the preamble quotes "Respond ACK…", so a bare ACK
      // assertion passes on tty echo of Orca's own write (ORCA-207/ORCA-209).
      // Why a cursored read: this fake echoes, and the reply lands early in a
      // long echo block that a bounded preview read drops off the top.
      await expect
        .poll(async () => {
          const read = await firstClient.call<{ terminal: RuntimeTerminalRead }>('terminal.read', {
            terminal: worker!.handle,
            cursor: 0,
            limit: 1000
          })
          return read.result.terminal.tail.join('\n')
        })
        .toContain('AGENT-STDOUT-ACK')
      const initialWorker = {
        ptyId: worker!.ptyId,
        incarnationId: worker!.incarnationId,
        worktreeId: worker!.worktreeId,
        tabId: worker!.tabId,
        leafId: worker!.leafId
      }
      const initialDispatch = await firstClient.call<{
        dispatch: {
          id: string
          task_id: string
          assignee_handle: string
          assignee_pane_key: string
          process_incarnation: string
        } | null
      }>('orchestration.dispatchShow', { task: task.result.task.id })
      expect(initialDispatch.result.dispatch).toEqual(
        expect.objectContaining({
          task_id: task.result.task.id,
          assignee_pane_key: workerPaneKey,
          process_incarnation: `${initialWorker.ptyId}:${initialWorker.incarnationId}`
        })
      )
      const dispatchHandle = initialDispatch.result.dispatch!.assignee_handle
      await expect.poll(() => readLedger(spawnLedgerPath)).toHaveLength(1)
      const [initialSpawn] = readLedger(spawnLedgerPath)
      expect(isProcessAlive(initialSpawn.pid)).toBe(true)
      expect(readLedger(interruptionLedgerPath)).toEqual([])
      await expect
        .poll(() => readLedger(authorityLedgerPath))
        .toEqual([expect.objectContaining({ event: 'authority-hook', status: 204 })])

      const transcriptPath = session.seedCodexResumeRollout(PROVIDER_SESSION_ID, repoPath)
      await first.page.evaluate(
        ({ paneKey, tabId, worktreeId: workerWorktreeId, terminalHandle, transcript }) => {
          window.__store?.getState().setAgentStatus(
            paneKey,
            { state: 'working', prompt: 'Respond ACK and remain idle', agentType: 'codex' },
            'Codex Ready',
            undefined,
            { tabId, worktreeId: workerWorktreeId, terminalHandle },
            {
              providerSession: {
                key: 'session_id',
                id: 'e2e-legacy-orchestration-worker',
                transcriptPath: transcript
              },
              launchConfig: {
                agentCommand: 'codex',
                agentArgs: '--dangerously-bypass-approvals-and-sandbox',
                agentEnv: {}
              }
            }
          )
          window.__store?.getState().captureAllSleepingAgentSessions('quit')
        },
        {
          paneKey: workerPaneKey,
          tabId: worker!.tabId,
          worktreeId: worker!.worktreeId,
          terminalHandle: worker!.handle,
          transcript: transcriptPath
        }
      )
      await expect
        .poll(() => hasPersistedResumeRecord(session.userDataDir, workerPaneKey), {
          timeout: 30_000
        })
        .toBe(true)

      await session.close(firstApp)
      firstApp = null
      expect(readLedger(spawnLedgerPath)).toEqual([initialSpawn])
      expect(readLedger(interruptionLedgerPath)).toEqual([])
      expect(isProcessAlive(initialSpawn.pid)).toBe(true)

      stripLegacyWorkerRendererBinding(session.userDataDir, {
        worktreeId,
        coordinatorTabId: coordinatorTabId!,
        workerTabId: worker!.tabId,
        workerPaneKey
      })
      const dispatchIdentity = {
        taskId: task.result.task.id,
        dispatchId: initialDispatch.result.dispatch!.id,
        terminalHandle: dispatchHandle,
        paneKey: workerPaneKey,
        processIncarnation: `${initialWorker.ptyId}:${initialWorker.incarnationId}`,
        worktreeId: initialWorker.worktreeId
      }
      if (contractVersion === LEGACY_CONTRACT_VERSION) {
        markAssignmentAsPreUpdateLegacy(session.userDataDir, dispatchIdentity)
      } else {
        assertDispatchRemainsCurrent(session.userDataDir, dispatchIdentity)
      }

      const second = await session.launch()
      secondApp = second.app
      await waitForSessionReady(second.page)
      expect(await waitForActiveWorktree(second.page)).toBe(worktreeId)
      const secondClient = new RuntimeClient(session.userDataDir, 30_000, null, null)
      let recovered = (
        await secondClient.call<RuntimeTerminalListResult>('terminal.list')
      ).result.terminals.find((terminal) => terminal.ptyId === initialWorker.ptyId)
      await expect
        .poll(async () => {
          const listed = await secondClient.call<RuntimeTerminalListResult>('terminal.list')
          const matches = listed.result.terminals.filter(
            (terminal) => terminal.ptyId === initialWorker.ptyId
          )
          recovered = matches[0]
          return matches
        })
        .toEqual([
          expect.objectContaining({
            ...initialWorker,
            connected: true,
            writable: true
          })
        ])

      const recoveredTab = second.page.locator(
        `[data-testid="sortable-tab"][data-tab-id="${initialWorker.tabId}"]`
      )
      await expect(recoveredTab).toBeVisible()
      await expect(recoveredTab).toHaveCount(1)
      await expect(recoveredTab).toHaveAttribute('data-active', 'false')
      await expect(
        second.page.locator(`[data-testid="sortable-tab"][data-tab-id="${coordinatorTabId!}"]`)
      ).toHaveAttribute('data-active', 'true')
      // Why the same marker: the adopted pane replays the same preamble echo, so a
      // bare ACK would confirm adoption from Orca's own text instead of the agent's
      // stdout (ORCA-207).
      // Why NO cursor here, unlike the pre-restart read: the second runtime holds no
      // transcript for an adopted pty, so the tail arrives only through
      // withVisibleSnapshotFallback's recovered-worker branch — and that whole
      // fallback is skipped when a cursor is passed. Widen the limit instead, so the
      // marker cannot fall off the top of the bounded preview window.
      await expect
        .poll(async () => {
          const read = await secondClient.call<{ terminal: RuntimeTerminalRead }>('terminal.read', {
            terminal: recovered!.handle,
            limit: 1000
          })
          return read.result.terminal.tail.join('\n')
        })
        .toContain('AGENT-STDOUT-ACK')

      let assignmentRunId = run.result.run.id
      if (contractVersion === LEGACY_CONTRACT_VERSION) {
        const runs = await listAllOrchestrationRuns(secondClient)
        assignmentRunId = runs.find(
          (candidate) =>
            candidate.objective === 'Recovered orchestration work from a contract update'
        )!.id
      }
      const restoredRun = await secondClient.call<{ run: { id: string } }>(
        'orchestration.runShow',
        { id: assignmentRunId }
      )
      expect(restoredRun.result.run.id).toBe(assignmentRunId)
      const tasks = await secondClient.call<{ tasks: { id: string }[] }>('orchestration.taskList', {
        run: assignmentRunId
      })
      expect(tasks.result.tasks).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: task.result.task.id })])
      )
      const recoveredDispatch = await secondClient.call<{
        dispatch: {
          id: string
          task_id: string
          assignee_handle: string
          assignee_pane_key: string
          process_incarnation: string
          contract_version: number
        } | null
      }>('orchestration.dispatchShow', { task: task.result.task.id })
      expect(recoveredDispatch.result.dispatch).toEqual(
        expect.objectContaining({
          id: initialDispatch.result.dispatch!.id,
          task_id: task.result.task.id,
          assignee_handle: dispatchHandle,
          assignee_pane_key: workerPaneKey,
          process_incarnation: `${initialWorker.ptyId}:${initialWorker.incarnationId}`,
          contract_version: contractVersion
        })
      )
      await expect
        .poll(async () => ({
          renderer: await readRendererRecoveryState(
            second.page,
            workerPaneKey,
            initialWorker.tabId
          ),
          persisted: hasPersistedResumeRecord(session.userDataDir, workerPaneKey)
        }))
        .toEqual({
          renderer: { sleeping: false, resumeClaim: false, pendingStartup: false },
          persisted: false
        })
      expect(readLedger(spawnLedgerPath)).toEqual([initialSpawn])
      expect(readLedger(interruptionLedgerPath)).toEqual([])
      expect(isProcessAlive(initialSpawn.pid)).toBe(true)

      if (contractVersion === LEGACY_CONTRACT_VERSION) {
        const legacyCompletion = Buffer.from(
          JSON.stringify({
            coordinatorHandle: coordinator.result.terminal.handle,
            taskId: task.result.task.id,
            dispatchId: initialDispatch.result.dispatch!.id
          })
        ).toString('base64')
        await secondClient.call('terminal.send', {
          terminal: recovered!.handle,
          text: `ORCA_E2E_RUN_LEGACY_DONE:${legacyCompletion}`,
          enter: true
        })
        await expect
          .poll(() => readLedger(lifecycleLedgerPath), { timeout: 30_000 })
          .toEqual([
            expect.objectContaining({
              event: 'legacy-command',
              pid: initialSpawn.pid,
              argv: [
                'orchestration',
                'send',
                '--to',
                coordinator.result.terminal.handle,
                '--type',
                'worker_done',
                '--subject',
                'Completed',
                '--body',
                'E2E retained legacy completion',
                '--payload',
                JSON.stringify({
                  taskId: task.result.task.id,
                  dispatchId: initialDispatch.result.dispatch!.id,
                  filesModified: []
                }),
                '--json'
              ],
              status: 0,
              stderr: ''
            })
          ])
        await expect
          .poll(async () => {
            const dispatch = await secondClient.call<{
              dispatch: { id: string; status: string } | null
            }>('orchestration.dispatchShow', { task: task.result.task.id })
            const listedTasks = await secondClient.call<{
              tasks: { id: string; status: string }[]
            }>('orchestration.taskList', { run: assignmentRunId })
            return {
              dispatch: dispatch.result.dispatch?.status,
              task: listedTasks.result.tasks.find(
                (candidate) => candidate.id === task.result.task.id
              )?.status
            }
          })
          .toEqual({ dispatch: 'completed', task: 'completed' })
        expect(readLedger(spawnLedgerPath)).toEqual([initialSpawn])
        expect(isProcessAlive(initialSpawn.pid)).toBe(true)
      } else {
        const currentCompletion = Buffer.from(
          JSON.stringify({
            terminalHandle: dispatchHandle,
            taskId: task.result.task.id,
            dispatchId: initialDispatch.result.dispatch!.id
          })
        ).toString('base64')
        await secondClient.call('terminal.send', {
          terminal: recovered!.handle,
          text: `ORCA_E2E_RUN_CURRENT_DONE:${currentCompletion}`,
          enter: true
        })
        await expect
          .poll(() => readLedger(lifecycleLedgerPath), { timeout: 30_000 })
          .toEqual([
            expect.objectContaining({
              event: 'current-command',
              pid: initialSpawn.pid,
              status: 0,
              stderr: ''
            })
          ])
        await expect
          .poll(async () => {
            const dispatch = await secondClient.call<{
              dispatch: { id: string; status: string } | null
            }>('orchestration.dispatchShow', { task: task.result.task.id })
            const listedTasks = await secondClient.call<{
              tasks: { id: string; status: string }[]
            }>('orchestration.taskList', { run: assignmentRunId })
            return {
              dispatch: dispatch.result.dispatch?.status,
              task: listedTasks.result.tasks.find(
                (candidate) => candidate.id === task.result.task.id
              )?.status
            }
          })
          .toEqual({ dispatch: 'completed', task: 'completed' })

        const checked = await secondClient.call<{
          messages: {
            type: string
            subject: string
            body: string | null
            payload: string | null
          }[]
        }>('orchestration.check', {
          run: run.result.run.id,
          terminal: coordinator.result.terminal.handle,
          terminalPaneKey: coordinatorPane.paneKey,
          types: ['worker_done']
        })
        expect(checked.result.messages).toEqual([
          expect.objectContaining({
            type: 'worker_done',
            subject: 'Completed',
            body: 'E2E retained current completion',
            payload: expect.stringContaining(initialDispatch.result.dispatch!.id)
          })
        ])
        expect(readLedger(spawnLedgerPath)).toEqual([initialSpawn])
        expect(isProcessAlive(initialSpawn.pid)).toBe(true)
      }

      const otherWorktreeId = await switchToOtherWorktree(second.page, worktreeId)
      expect(otherWorktreeId).toBeTruthy()
      await switchToWorktree(second.page, worktreeId)
      await expect(recoveredTab).toBeVisible()
      await expect(recoveredTab).toHaveCount(1)
      await expect(recoveredTab).toHaveAttribute('data-active', 'false')
      await expect
        .poll(async () =>
          readRendererRecoveryState(second.page, workerPaneKey, initialWorker.tabId)
        )
        .toEqual({ sleeping: false, resumeClaim: false, pendingStartup: false })
      expect(readLedger(spawnLedgerPath)).toEqual([initialSpawn])
      expect(readLedger(interruptionLedgerPath)).toEqual([])
      expect(isProcessAlive(initialSpawn.pid)).toBe(true)
      await expect(second.page.locator('body')).not.toContainText('Conversation interrupted')
    } finally {
      if (secondApp) {
        await session.close(secondApp).catch(() => undefined)
      }
      if (firstApp) {
        await session.close(firstApp).catch(() => undefined)
      }
      await session.dispose()
    }
  })
}
