import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { SleepingAgentSessionRecord } from '../../src/shared/agent-session-resume'
import { TERMINAL_WAKE_RUNTIME_CAPABILITY } from '../../src/shared/protocol-version'
import type {
  RuntimeStatus,
  RuntimeTerminalListResult,
  RuntimeTerminalSummary,
  RuntimeTerminalWake
} from '../../src/shared/runtime-types'

// Why: after a host restart a member's pane came back asleep, and a lead on
// another machine could only wake it by clicking it in that host's UI (ORCA-915).

async function seedWorktreeSleptRecord(
  page: Page,
  worktreeId: string,
  paneKey: string,
  sessionId: string
): Promise<void> {
  const record: SleepingAgentSessionRecord = {
    paneKey,
    tabId: paneKey.split(':')[0]!,
    worktreeId,
    agent: 'claude',
    providerSession: { key: 'session_id', id: sessionId },
    prompt: 'implement ORCA-915',
    state: 'working',
    capturedAt: Date.now(),
    updatedAt: Date.now(),
    origin: 'worktree-sleep'
  }
  await page.evaluate((next) => {
    window.__store?.setState((state) => ({
      sleepingAgentSessionsByPaneKey: {
        ...state.sleepingAgentSessionsByPaneKey,
        [next.paneKey]: next
      }
    }))
  }, record)
}

async function listTerminals(client: RuntimeClient): Promise<RuntimeTerminalSummary[]> {
  return (await client.call<RuntimeTerminalListResult>('terminal.list')).result.terminals
}

const isSleepingRowOf = (paneKey: string) => (terminal: RuntimeTerminalSummary) =>
  `${terminal.tabId}:${terminal.leafId}` === paneKey && terminal.liveness === 'sleeping'

test.describe('waking a sleeping row through the runtime', () => {
  test('resumes the slept session without changing what the window shows', async ({
    orcaPage,
    electronApp
  }) => {
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = new RuntimeClient(userDataDir, 60_000, null, null)
    await expect
      .poll(
        async () =>
          (
            await client.call<{ worktrees: { id: string }[] }>('worktree.list', {})
          ).result.worktrees.some((worktree) => worktree.id === worktreeId),
        { timeout: 30_000 }
      )
      .toBe(true)

    const status = await client.call<RuntimeStatus>('status.get')
    expect(status.result.capabilities).toContain(TERMINAL_WAKE_RUNTIME_CAPABILITY)

    const paneKey = `${randomUUID()}:${randomUUID()}`
    const sessionId = randomUUID()
    await seedWorktreeSleptRecord(orcaPage, worktreeId, paneKey, sessionId)
    let asleep: RuntimeTerminalSummary | undefined
    await expect
      .poll(async () => {
        asleep = (await listTerminals(client)).find(isSleepingRowOf(paneKey))
        return Boolean(asleep)
      })
      .toBe(true)
    const before = await orcaPage.evaluate(
      (id) => ({
        activeTabId: window.__store?.getState().activeTabId ?? null,
        tabIds: (window.__store?.getState().tabsByWorktree[id] ?? []).map((tab) => tab.id)
      }),
      worktreeId
    )

    const wake = await client.call<{ wake: RuntimeTerminalWake }>('terminal.wake', {
      terminal: asleep!.handle
    })

    expect(wake.result.wake.status).not.toBe('awake')
    expect(wake.result.wake.paneKey).toBe(paneKey)
    const after = await orcaPage.evaluate(
      (id) => ({
        activeTabId: window.__store?.getState().activeTabId ?? null,
        tabIds: (window.__store?.getState().tabsByWorktree[id] ?? []).map((tab) => tab.id)
      }),
      worktreeId
    )
    // The session reopened in a fresh background tab; the window kept its tab.
    expect(after.tabIds.filter((id) => !before.tabIds.includes(id))).toHaveLength(1)
    expect(after.activeTabId).toBe(before.activeTabId)
    expect(
      await orcaPage.evaluate(
        (key) => Boolean(window.__store?.getState().sleepingAgentSessionsByPaneKey[key]),
        paneKey
      )
    ).toBe(false)
    expect((await listTerminals(client)).some(isSleepingRowOf(paneKey))).toBe(false)
  })
})
