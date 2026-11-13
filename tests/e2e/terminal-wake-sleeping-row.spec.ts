import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import { createResumedClaudeAgent, type ResumedClaudeAgent } from './helpers/resumed-claude-agent'
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
import { writeSettings } from './helpers/settings-write'

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
  let agent: ResumedClaudeAgent | null = null
  test.afterEach(() => agent?.dispose())

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
    // Why resumable (ORCA-1167): Orca refuses a made-up session and closes its tab as the spec reads it;
    // the stand-in reports the session as Claude's hook does, the only way wake knows its fresh tab.
    const transcripts = path.join(userDataDir, 'claude-transcripts', 'projects', 'e2e')
    mkdirSync(transcripts, { recursive: true })
    writeFileSync(path.join(transcripts, `${sessionId}.jsonl`), '')
    agent = createResumedClaudeAgent(sessionId)
    await writeSettings(orcaPage, { agentCmdOverrides: { claude: agent.command } })
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

    // Why 'woken' with a handle: 'waking' also covers a resume Orca refused and tore down (ORCA-1167).
    expect(wake.result.wake).toMatchObject({ status: 'woken', paneKey })
    const wokenHandle = wake.result.wake.handle
    expect(wokenHandle).toBeTruthy()
    const readTabs = (): Promise<{
      activeTabId: string | null
      tabIds: string[]
    }> =>
      orcaPage.evaluate(
        (id) => ({
          activeTabId: window.__store?.getState().activeTabId ?? null,
          tabIds: (window.__store?.getState().tabsByWorktree[id] ?? []).map((tab) => tab.id)
        }),
        worktreeId
      )
    const newTabs = async (): Promise<string[]> =>
      (await readTabs()).tabIds.filter((id) => !before.tabIds.includes(id))
    // The session reopened in a fresh background tab; the window kept its tab.
    await expect.poll(newTabs).toHaveLength(1)
    expect((await readTabs()).activeTabId).toBe(before.activeTabId)
    // Why again: a torn-down resume shows its tab for a moment, then closes it.
    expect(
      (await listTerminals(client)).find((terminal) => terminal.handle === wokenHandle)?.liveness
    ).toMatch(/^(running|starting)$/)
    expect(await newTabs()).toHaveLength(1)
    expect(
      await orcaPage.evaluate(
        (key) => Boolean(window.__store?.getState().sleepingAgentSessionsByPaneKey[key]),
        paneKey
      )
    ).toBe(false)
    expect((await listTerminals(client)).some(isSleepingRowOf(paneKey))).toBe(false)
  })
})
