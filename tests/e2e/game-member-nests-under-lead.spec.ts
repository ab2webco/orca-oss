import { existsSync, readFileSync } from 'node:fs'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { cleanupE2EDaemons } from './helpers/electron-process-shutdown'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForSessionReady, waitForActiveWorktree } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import { worktreeRow } from './worktree-row-locators'

type Lead = { handle: string; worktreeId: string }
type Started = { state: string; effects: { kind: string; action?: string; warning?: string }[] }

// Why polled: the restored lead pane binds a terminal handle a moment after the window loads.
async function resolveLead(client: RuntimeClient, paneKey: string): Promise<Lead> {
  let lead: Lead | null = null
  await expect
    .poll(
      async () => {
        try {
          const pane = await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
            paneKey
          })
          const shown = await client.call<{ terminal: { worktreeId: string } }>('terminal.show', {
            terminal: pane.result.terminal.handle
          })
          lead = {
            handle: pane.result.terminal.handle,
            worktreeId: shown.result.terminal.worktreeId
          }
        } catch {
          lead = null
        }
        return lead !== null
      },
      { timeout: 60_000, message: 'the lead pane never resolved to a terminal' }
    )
    .toBe(true)
  return lead!
}

/** A worktree made with no lineage, the shape a relaunch or --repo launch used to leave top-level. */
async function createBareWorktree(page: Page, client: RuntimeClient, name: string) {
  const id = await page.evaluate(async (branch) => {
    const state = window.__store!.getState()
    const active = Object.values(state.worktreesByRepo)
      .flat()
      .find((worktree) => worktree.id === state.activeWorktreeId)!
    return (await state.createWorktree(active.repoId, branch)).worktree.id
  }, name)
  await expect
    .poll(() =>
      client.call('worktree.show', { worktree: `id:${id}` }).then(
        () => true,
        () => false
      )
    )
    .toBe(true)
  return id
}

async function startGameMember(
  client: RuntimeClient,
  lead: Lead,
  worktreeId: string,
  ticket: string
) {
  const run = await client.call<{ run: { id: string } }>('orchestration.runCurrent', {
    from: lead.handle
  })
  const runId =
    run.result.run?.id ??
    (
      await client.call<{ run: { id: string } }>('orchestration.runCreate', {
        objective: 'Members nest under their lead',
        from: lead.handle
      })
    ).result.run.id
  const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
    spec: 'Stay idle and wait',
    taskTitle: ticket,
    run: runId,
    callerTerminalHandle: lead.handle
  })
  return (
    await client.call<Started>('orchestration.workerStart', {
      task: task.result.task.id,
      from: lead.handle,
      worktree: `id:${worktreeId}`,
      displayName: ticket,
      agent: 'codex',
      timeoutMs: 20_000,
      game: true
    })
  ).result
}

async function expectNested(page: Page, lead: Lead, members: string[]): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          (ids) =>
            ids.map((id) => window.__store?.getState().worktreeLineageById[id]?.parentWorktreeId),
          members
        ),
      { timeout: 30_000, message: 'a member is not nested under the lead' }
    )
    .toEqual(members.map(() => lead.worktreeId))
  const count = members.length
  await expect(
    worktreeRow(page, lead.worktreeId).getByRole('button', {
      name: `Hide ${count} child workspace${count === 1 ? '' : 's'}`
    })
  ).toBeVisible({ timeout: 15_000 })
}

// ORCA-1116 row 24: a member started into an existing worktree got no lineage edge and sat top-level.
test('game members nest under their lead before and after a real restart', async ({
  flushRendererRecoveryEvidenceQueue
}, testInfo) => {
  void flushRendererRecoveryEvidenceQueue
  test.setTimeout(420_000)
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
    : ''
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

  const agent = createStdinLoggingAgent()
  const session = createRestartSession(testInfo)
  let firstApp: ElectronApplication | null = null
  let secondApp: ElectronApplication | null = null

  try {
    const first = await session.launch()
    firstApp = first.app
    await attachRepoAndOpenTerminal(first.page, repoPath)
    await waitForSessionReady(first.page)
    // Why an override: the login shell's PATH puts a real codex ahead of any fixture dir.
    await first.page.evaluate(async (command) => {
      await window.__store?.getState().updateSettings({
        defaultTuiAgent: 'codex',
        agentCmdOverrides: { codex: command },
        agentDefaultArgs: { codex: '' }
      })
    }, agent.command)
    await ensureTerminalVisible(first.page)
    await waitForActivePanePtyId(first.page)
    const leadPane = await waitForActivePaneHookDescriptor(first.page)
    const firstClient = new RuntimeClient(session.userDataDir, 30_000, null, null)
    const firstLead = await resolveLead(firstClient, leadPane.paneKey)

    const before = await createBareWorktree(first.page, firstClient, 'e2e-1116-a')
    expect(
      await first.page.evaluate((id) => window.__store?.getState().worktreeLineageById[id], before)
    ).toBeUndefined()
    const startedBefore = await startGameMember(firstClient, firstLead, before, 'E2E-1116-A')
    expect(startedBefore.effects.filter((one) => one.action === 'lineage_unresolved')).toEqual([])
    await expectNested(first.page, firstLead, [before])
    await first.page.screenshot({ path: testInfo.outputPath('nested-before-restart.png') })

    await session.close(firstApp)
    firstApp = null
    await cleanupE2EDaemons(session.userDataDir)

    const second = await session.launch()
    secondApp = second.app
    await waitForSessionReady(second.page)
    await waitForActiveWorktree(second.page)
    const secondClient = new RuntimeClient(session.userDataDir, 30_000, null, null)
    const secondLead = await resolveLead(secondClient, leadPane.paneKey)
    await expectNested(second.page, secondLead, [before])

    const after = await createBareWorktree(second.page, secondClient, 'e2e-1116-b')
    const startedAfter = await startGameMember(secondClient, secondLead, after, 'E2E-1116-B')
    expect(startedAfter.effects.filter((one) => one.action === 'lineage_unresolved')).toEqual([])
    await expectNested(second.page, secondLead, [before, after])
    await second.page.screenshot({ path: testInfo.outputPath('nested-after-restart.png') })
  } finally {
    if (secondApp) {
      await session.close(secondApp)
    }
    if (firstApp) {
      await session.close(firstApp)
    }
    await session.dispose()
    agent.dispose()
  }
})
