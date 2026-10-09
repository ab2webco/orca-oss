import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { SleepingAgentSessionRecord } from '../../src/shared/agent-session-resume'
import type {
  RuntimeTerminalListResult,
  RuntimeTerminalSummary
} from '../../src/shared/runtime-types'

// Why: the renderer owns the resume records and re-persists them. A close that
// forgot only main's copy looked done until the next persist relisted the row
// under a new handle — the leftovers an automation plugin could not remove (ORCA-560).

function paneKeyOf(terminal: Pick<RuntimeTerminalSummary, 'tabId' | 'leafId'>): string {
  return `${terminal.tabId}:${terminal.leafId}`
}

async function seedSleepingRecord(page: Page, worktreeId: string, paneKey: string): Promise<void> {
  const record: SleepingAgentSessionRecord = {
    paneKey,
    tabId: paneKey.split(':')[0]!,
    worktreeId,
    agent: 'claude',
    providerSession: { key: 'session_id', id: randomUUID() },
    prompt: '',
    state: 'working',
    capturedAt: Date.now(),
    updatedAt: Date.now(),
    origin: 'live'
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

async function rendererHasRecord(page: Page, paneKey: string): Promise<boolean> {
  return page.evaluate(
    (key) => Boolean(window.__store?.getState().sleepingAgentSessionsByPaneKey[key]),
    paneKey
  )
}

async function listTerminals(client: RuntimeClient): Promise<RuntimeTerminalSummary[]> {
  return (await client.call<RuntimeTerminalListResult>('terminal.list')).result.terminals
}

async function waitForSleepingRow(
  client: RuntimeClient,
  paneKey: string
): Promise<RuntimeTerminalSummary> {
  let row: RuntimeTerminalSummary | undefined
  await expect
    .poll(async () => {
      row = (await listTerminals(client)).find(
        (terminal) => paneKeyOf(terminal) === paneKey && terminal.liveness === 'sleeping'
      )
      return Boolean(row)
    })
    .toBe(true)
  return row!
}

/** Seeds an unrelated record and waits for it to be listed, which proves the
 *  renderer persisted again after the close under test. */
async function expectGoneAfterNextPersist(
  page: Page,
  client: RuntimeClient,
  worktreeId: string,
  closedPaneKey: string
): Promise<void> {
  await expect.poll(() => rendererHasRecord(page, closedPaneKey)).toBe(false)
  const witnessPaneKey = `${randomUUID()}:${randomUUID()}`
  await seedSleepingRecord(page, worktreeId, witnessPaneKey)
  await waitForSleepingRow(client, witnessPaneKey)
  const listed = await listTerminals(client)
  expect(listed.some((terminal) => paneKeyOf(terminal) === closedPaneKey)).toBe(false)
}

test.describe('closing a sleeping row through the runtime', () => {
  let client: RuntimeClient
  let worktreeId: string

  test.beforeEach(async ({ orcaPage, electronApp }) => {
    await waitForSessionReady(orcaPage)
    worktreeId = await waitForActiveWorktree(orcaPage)
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    client = new RuntimeClient(userDataDir, 30_000, null, null)
  })

  test('an orphaned sleeping row closed with --tab stays gone', async ({ orcaPage }) => {
    const paneKey = `${randomUUID()}:${randomUUID()}`
    await seedSleepingRecord(orcaPage, worktreeId, paneKey)
    const row = await waitForSleepingRow(client, paneKey)

    await client.call('terminal.closeTab', { terminal: row.handle })

    await expectGoneAfterNextPersist(orcaPage, client, worktreeId, paneKey)
  })

  test('a live agent tab closed with --tab leaves no sleeping row', async ({ orcaPage }) => {
    await ensureTerminalVisible(orcaPage)
    await waitForActivePanePtyId(orcaPage)
    const { paneKey } = await waitForActivePaneHookDescriptor(orcaPage)
    const resolved = await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
      paneKey
    })
    // Why: a Claude pane records its resume identity at SessionStart, while it runs.
    await seedSleepingRecord(orcaPage, worktreeId, paneKey)

    await client.call('terminal.closeTab', { terminal: resolved.result.terminal.handle })

    await expectGoneAfterNextPersist(orcaPage, client, worktreeId, paneKey)
  })
})
