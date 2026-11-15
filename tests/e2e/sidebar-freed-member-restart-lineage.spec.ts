/**
 * ORCA-1216 §6: a freed Agent Teams member's worktree stays nested under its lead's in the sidebar
 * after Orca restarts, even when its lineage edge did not survive. Member A is freed with the same
 * calls `orca game stop` makes and its edge is dropped while Orca is closed; member B stays live.
 * Neither member is relaunched after the restart.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { createRestartSession } from './helpers/orca-restart'
import { createFakeClaude, startIdleLead } from './helpers/idle-lead-restart'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'
import { readCallerGameState } from '../../src/cli/handlers/orchestrator-game-board-call'
import { stopGameMembers } from '../../src/cli/handlers/orchestrator-game-stop'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'
import type { WorktreeLineage } from '../../src/shared/worktree/lineage-types'

type Ids = { lead: string; a: string; b: string }

type RendererView = {
  lineage: WorktreeLineage | null
  childInstanceId: string | null
  parentInstanceId: string | null
  rowPresent: boolean
  nestedInLeadRow: boolean
  indentPx: number | null
}

type MemberView = {
  mainEdge: WorktreeLineage | null
  mainChildInstanceId: string | null
  mainParentInstanceId: string | null
  renderer: RendererView
}

type Snapshot = { a: MemberView; b: MemberView }

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

async function instanceIdOf(client: RuntimeClient, id: string): Promise<string | null> {
  const shown = await client
    .call<{ worktree: { instanceId?: string } }>('worktree.show', { worktree: `id:${id}` })
    .catch(() => null)
  return shown?.result.worktree.instanceId ?? null
}

async function rendererView(page: Page, child: string, lead: string): Promise<RendererView> {
  return page.evaluate(
    ({ child, lead }) => {
      const state = window.__store!.getState()
      const all = Object.values(state.worktreesByRepo).flat()
      const leadRow = document.querySelector<HTMLElement>(`[data-worktree-id="${lead}"]`)
      const row = document.querySelector<HTMLElement>(`[data-worktree-id="${child}"]`)
      const surface = (node: HTMLElement | null) =>
        node?.querySelector<HTMLElement>('[data-worktree-card-surface]') ?? node
      const leadBox = surface(leadRow)?.getBoundingClientRect()
      const rowBox = surface(row)?.getBoundingClientRect()
      return {
        lineage: state.worktreeLineageById[child] ?? null,
        childInstanceId: all.find((one) => one.id === child)?.instanceId ?? null,
        parentInstanceId: all.find((one) => one.id === lead)?.instanceId ?? null,
        rowPresent: row !== null,
        nestedInLeadRow: Boolean(leadRow && row && leadRow !== row && leadRow.contains(row)),
        indentPx: leadBox && rowBox ? Math.round(rowBox.left - leadBox.left) : null
      }
    },
    { child, lead }
  )
}

async function snapshot(page: Page, client: RuntimeClient, ids: Ids): Promise<Snapshot> {
  const { lineage } = (
    await client.call<{ lineage: Record<string, WorktreeLineage> }>('worktree.lineageList')
  ).result
  const parentInstanceId = await instanceIdOf(client, ids.lead)
  const view = async (child: string): Promise<MemberView> => ({
    mainEdge: lineage[child] ?? null,
    mainChildInstanceId: await instanceIdOf(client, child),
    mainParentInstanceId: parentInstanceId,
    renderer: await rendererView(page, child, ids.lead)
  })
  return { a: await view(ids.a), b: await view(ids.b) }
}

function persistedOf(userDataDir: string, ids: Ids) {
  // Why the profile path: worktree meta and lineage persist in the active profile's state file.
  const file = path.join(userDataDir, 'profiles', 'local-default', 'orca-data.json')
  const data = JSON.parse(readFileSync(file, 'utf8')) as {
    worktreeLineageById?: Record<string, WorktreeLineage>
    worktreeMeta?: Record<string, { instanceId?: string }>
  }
  const of = (id: string) => ({
    edge: data.worktreeLineageById?.[id] ?? null,
    childInstanceId: data.worktreeMeta?.[id]?.instanceId ?? null,
    parentInstanceId: data.worktreeMeta?.[ids.lead]?.instanceId ?? null
  })
  return { a: of(ids.a), b: of(ids.b) }
}

function dropPersistedEdge(userDataDir: string, worktreeId: string): void {
  const file = path.join(userDataDir, 'profiles', 'local-default', 'orca-data.json')
  const data = JSON.parse(readFileSync(file, 'utf8')) as {
    worktreeLineageById?: Record<string, unknown>
    workspaceLineageByChildKey?: Record<string, unknown>
  }
  expect(data.worktreeLineageById?.[worktreeId], 'no edge to drop').toBeTruthy()
  delete data.worktreeLineageById?.[worktreeId]
  delete data.workspaceLineageByChildKey?.[`worktree:${worktreeId}`]
  writeFileSync(file, JSON.stringify(data))
}

function annotate(testInfo: { annotations: { type: string; description?: string }[] }) {
  return (type: string, value: unknown): void => {
    testInfo.annotations.push({ type, description: JSON.stringify(value) })
  }
}

test('a freed member stays nested under its lead in the sidebar after Orca restarts', async ({
  flushRendererRecoveryEvidenceQueue
}, testInfo) => {
  void flushRendererRecoveryEvidenceQueue
  test.setTimeout(420_000)
  test.skip(process.platform === 'win32', 'The fake Claude is a copy of the POSIX sleep binary')
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
    : ''
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

  const note = annotate(testInfo)
  const fake = createFakeClaude()
  const agent = createStdinLoggingAgent()
  const session = createRestartSession(testInfo)
  let firstApp: ElectronApplication | null = null
  let secondApp: ElectronApplication | null = null
  const savedEnv = {
    ORCA_WORKTREE_ID: process.env.ORCA_WORKTREE_ID,
    ORCA_TERMINAL_HANDLE: process.env.ORCA_TERMINAL_HANDLE,
    ORCA_PANE_KEY: process.env.ORCA_PANE_KEY
  }
  try {
    const first = await session.launch()
    firstApp = first.app
    const page = first.page
    const lead = await startIdleLead({
      page,
      userDataDir: session.userDataDir,
      repoPath,
      fake,
      project: 'e2e-freed-lineage'
    })
    const client = lead.client
    // Why: the stop handler reads the lead's identity from the pane env it runs in.
    process.env.ORCA_WORKTREE_ID = lead.worktreeId
    process.env.ORCA_TERMINAL_HANDLE = lead.handle
    process.env.ORCA_PANE_KEY = lead.paneKey

    await writeSettings(page, {
      defaultTuiAgent: 'codex',
      agentCmdOverrides: { codex: agent.command },
      agentDefaultArgs: { codex: '' }
    })
    await page.evaluate(() => {
      const state = window.__store!.getState()
      state.setGroupBy('repo')
      state.setRightSidebarOpen(false)
    })

    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Freed member lineage',
      from: lead.handle
    })
    const member = async (ticket: string, displayName: string) => {
      const worktreeId = await createBareWorktree(page, client, ticket.toLowerCase())
      const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
        spec: `Work on ${ticket}`,
        taskTitle: displayName,
        run: run.result.run.id,
        callerTerminalHandle: lead.handle
      })
      const started = await client.call<{
        effects: { kind: string; role?: string; id?: string }[]
      }>('orchestration.workerStart', {
        task: task.result.task.id,
        from: lead.handle,
        worktree: `id:${worktreeId}`,
        displayName,
        agent: 'codex',
        timeoutMs: 20_000,
        game: true
      })
      const handle = started.result.effects.find(
        (effect) => effect.kind === 'terminal' && effect.role === 'agent'
      )?.id
      const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
      const terminal = listed.result.terminals.find((one) => one.handle === handle)
      expect(terminal, `the ${ticket} terminal is not listed`).toBeTruthy()
      return { paneKey: `${terminal!.tabId}:${terminal!.leafId}`, worktreeId }
    }
    const memberA = await member('ORCA-9001', 'Caballero · ORCA-9001 Freed member')
    const memberB = await member('ORCA-9002', 'Escudero · ORCA-9002 Live member')
    const ids: Ids = { lead: lead.worktreeId, a: memberA.worktreeId, b: memberB.worktreeId }
    note('ids', ids)

    // Why hooks: game.state lists a member once its pane reports agent status.
    const endpoint = await readHookEndpoint(first.app)
    await expect
      .poll(
        async () => {
          for (const one of [memberA, memberB]) {
            await emitCodexHookStatus(endpoint, { ...one, state: 'working', prompt: 'Work' })
          }
          const state = (await readCallerGameState(client)).result
          return ['ORCA-9001', 'ORCA-9002'].filter((ticket) =>
            state.agents.some((one) => one.isMember && one.displayName?.includes(ticket))
          )
        },
        { timeout: 120_000, message: 'game.state never listed both members' }
      )
      .toEqual(['ORCA-9001', 'ORCA-9002'])
    await expect
      .poll(async () => (await rendererView(page, ids.a, ids.lead)).nestedInLeadRow, {
        timeout: 60_000,
        message: 'member A never nested under the lead before the stop'
      })
      .toBe(true)
    note('after start', await snapshot(page, client, ids))

    // Free A exactly as `orca game stop ORCA-9001` does.
    const stop = await stopGameMembers(client, (await readCallerGameState(client)).result, [
      'ORCA-9001'
    ])
    note('stop result', stop)
    expect(stop.members.map((one) => one.outcome)).toEqual(['stopped'])
    expect(stop.members[0]?.history).toBeUndefined()
    await expect
      .poll(async () =>
        (await readCallerGameState(client)).result.agents.some(
          (one) => one.isMember && one.displayName?.includes('ORCA-9001')
        )
      )
      .toBe(false)

    const before = await snapshot(page, client, ids)
    note('before restart (after free)', before)
    await page.screenshot({ path: testInfo.outputPath('freed-lineage-before.png') })

    await session.close(first.app)
    firstApp = null
    note('persisted after close', persistedOf(session.userDataDir, ids))
    // The owner's failure shape (ORCA-1216 §6): A's edge is gone when Orca comes back. Only the
    // member history, which names A's worktree and its lead, can nest it again.
    dropPersistedEdge(session.userDataDir, ids.a)

    const second = await session.launch()
    secondApp = second.app
    await waitForSessionReady(second.page)
    await second.page.evaluate(() => window.__store!.getState().setGroupBy('repo'))
    await expect
      .poll(
        () =>
          second.page.evaluate(
            (wanted) => {
              const all = Object.values(window.__store!.getState().worktreesByRepo).flat()
              return wanted.every((id) => all.some((one) => one.id === id))
            },
            [ids.lead, ids.a, ids.b]
          ),
        { timeout: 60_000, message: 'worktrees never hydrated after the restart' }
      )
      .toBe(true)
    // Why poll the row, not assert once: lineage hydrates after the worktree list.
    await expect
      .poll(async () => (await rendererView(second.page, ids.b, ids.lead)).rowPresent, {
        timeout: 60_000
      })
      .toBe(true)
    // Settle: give lineage hydration and any startup pruning a chance to land.
    await second.page.waitForTimeout(5_000)
    const secondClient = new RuntimeClient(session.userDataDir, 30_000, null, null)
    const after = await snapshot(second.page, secondClient, ids)
    note('after restart', after)
    note('persisted after restart', persistedOf(session.userDataDir, ids))
    await second.page.screenshot({ path: testInfo.outputPath('freed-lineage-after.png') })

    expect(before.a.renderer.nestedInLeadRow, 'A nested before restart').toBe(true)
    expect(after.b.renderer.nestedInLeadRow, 'live B nested after restart').toBe(true)
    expect(after.a.mainEdge?.parentWorktreeId, 'A edge after restart').toBe(ids.lead)
    expect(after.a.renderer.nestedInLeadRow, 'freed A nested after restart').toBe(true)
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    if (secondApp) {
      await session.close(secondApp)
    }
    if (firstApp) {
      await session.close(firstApp)
    }
    await session.dispose()
    agent.dispose()
    fake.dispose()
  }
})
