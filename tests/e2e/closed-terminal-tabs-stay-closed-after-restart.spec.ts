import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import {
  execInTerminal,
  focusActiveTerminalInput,
  waitForActivePaneHookDescriptor,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { cleanupE2EDaemons } from './helpers/electron-process-shutdown'
import { getGoldenStubAgentLaunchEnv, GOLDEN_STUB_READY_MARKER } from './helpers/golden-stub-agent'
import { readHookEndpoint } from './helpers/agent-hook-endpoint'

// ORCA-1128: a tab closed with the X must never come back after a warm or cold restart, and a
// tab left open must. The close only sticks once main retires the surface and persists it.

const SORTABLE_TAB = '[data-testid="sortable-tab"]'

function readPersistedTabIds(userDataDir: string, workspaceId: string): string[] | null {
  const profilesDir = path.join(userDataDir, 'profiles')
  const dataFile = existsSync(profilesDir)
    ? readdirSync(profilesDir)
        .map((profile) => path.join(profilesDir, profile, 'orca-data.json'))
        .find((file) => existsSync(file))
    : undefined
  if (!dataFile) {
    return null
  }
  const data = JSON.parse(readFileSync(dataFile, 'utf8')) as {
    workspaceSession?: { tabsByWorktree?: Record<string, { id: string }[]> }
  }
  return (data.workspaceSession?.tabsByWorktree?.[workspaceId] ?? []).map((tab) => tab.id).sort()
}

async function rendererTabIds(page: Page, workspaceId: string): Promise<string[]> {
  return page.evaluate(
    (id) => (window.__store?.getState().tabsByWorktree[id] ?? []).map((tab) => tab.id).sort(),
    workspaceId
  )
}

async function waitForTabPty(page: Page, tabId: string): Promise<string> {
  let ptyId = ''
  await expect
    .poll(
      async () => {
        ptyId = await page.evaluate(
          (id) => window.__store?.getState().ptyIdsByTabId[id]?.[0] ?? '',
          tabId
        )
        return ptyId
      },
      { timeout: 30_000, message: `tab ${tabId} never got a PTY` }
    )
    .not.toBe('')
  return ptyId
}

async function openShellTab(page: Page, workspaceId: string): Promise<string> {
  const tabId = await page.evaluate(
    (id) => window.__store!.getState().createTab(id, undefined, undefined, { activate: true }).id,
    workspaceId
  )
  await waitForTabPty(page, tabId)
  return tabId
}

async function openWorkingClaudeTab(
  app: ElectronApplication,
  page: Page,
  workspaceId: string
): Promise<string> {
  const before = await rendererTabIds(page, workspaceId)
  await page.getByRole('button', { name: 'New tab' }).click({ force: true })
  const launch = page.getByRole('menuitem', { name: /^Claude(?:\s|$)/i }).first()
  await expect(launch).toBeVisible({ timeout: 15_000 })
  await launch.click({ force: true })
  await focusActiveTerminalInput(page)
  await waitForTerminalOutput(page, GOLDEN_STUB_READY_MARKER, 20_000)
  const tabId = (await rendererTabIds(page, workspaceId)).find((id) => !before.includes(id))!
  // Why: a working agent is what raises the "Stop this agent?" dialog the live check used.
  const pane = await waitForActivePaneHookDescriptor(page)
  const endpoint = await readHookEndpoint(app)
  for (const payload of [
    { hook_event_name: 'SessionStart', source: 'startup' },
    { hook_event_name: 'UserPromptSubmit', prompt: 'keep working' }
  ]) {
    const response = await fetch(`http://127.0.0.1:${endpoint.port}/hook/claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Orca-Agent-Hook-Token': endpoint.token },
      body: JSON.stringify({
        paneKey: pane.paneKey,
        tabId: pane.paneKey.split(':')[0],
        worktreeId: pane.worktreeId,
        env: endpoint.env,
        version: endpoint.version,
        payload: { session_id: randomUUID(), ...payload }
      })
    })
    expect(response.status).toBe(204)
  }
  await expect
    .poll(() =>
      page.evaluate(
        (key) => window.__store?.getState().agentStatusByPaneKey[key]?.state,
        pane.paneKey
      )
    )
    .toBe('working')
  return tabId
}

async function closeWithX(
  page: Page,
  tabId: string,
  confirm: 'none' | 'running command' | 'agent'
): Promise<void> {
  if (confirm === 'running command') {
    const ptyId = await waitForTabPty(page, tabId)
    await page.evaluate((id) => window.__store!.getState().setActiveTab(id), tabId)
    await execInTerminal(page, ptyId, 'sleep 300')
    await expect
      .poll(
        async () =>
          (await page.evaluate((id) => window.api.pty.inspectProcess(id), ptyId)).foregroundProcess,
        { timeout: 20_000, message: 'sleep 300 never became the foreground process' }
      )
      .toBe('sleep')
  }
  const tab = page.locator(`${SORTABLE_TAB}[data-tab-id="${tabId}"]`).first()
  await tab.hover()
  await tab.getByRole('button', { name: /^Close tab /i }).click()
  if (confirm !== 'none') {
    const button = confirm === 'agent' ? /^Stop Agent$/ : /^Stop and Close$/
    await page.getByRole('button', { name: button }).click()
  }
  await expect(tab).toHaveCount(0, { timeout: 15_000 })
}

async function expectTabs(
  page: Page,
  userDataDir: string,
  workspaceId: string,
  expected: string[],
  when: string
): Promise<void> {
  const sorted = [...expected].sort()
  await expect
    .poll(() => rendererTabIds(page, workspaceId), { message: `renderer tabs ${when}` })
    .toEqual(sorted)
  // Why disk: the renderer drops a closed tab at once; only main's write proves it won't return.
  await expect
    .poll(() => readPersistedTabIds(userDataDir, workspaceId), {
      timeout: 15_000,
      message: `persisted tabs ${when}`
    })
    .toEqual(sorted)
}

test.describe.configure({ mode: 'serial' })

for (const workspaceKind of ['git worktree', 'folder workspace'] as const) {
  test(`terminal tabs closed with the X stay closed after restarts in a ${workspaceKind}`, async ({
    flushRendererRecoveryEvidenceQueue
  }, testInfo) => {
    void flushRendererRecoveryEvidenceQueue
    test.setTimeout(300_000)
    const repoPath = readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
    if (!repoPath || !existsSync(repoPath)) {
      test.skip(true, 'Global setup did not produce a seeded test repo')
      return
    }
    const folderPath = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-closed-tabs-folder-'))
    const session = createRestartSession(
      testInfo,
      getGoldenStubAgentLaunchEnv() as Record<string, string>
    )
    let app: ElectronApplication | null = null

    const activate = async (page: Page, workspaceId: string): Promise<void> => {
      // Why retry: after a relaunch the folder workspace list hydrates after session readiness.
      await expect
        .poll(
          () =>
            page.evaluate((id) => {
              const state = window.__store!.getState()
              const known =
                !id.startsWith('folder:') ||
                state.folderWorkspaces.some((folder) => `folder:${folder.id}` === id)
              if (known && state.activeWorktreeId !== id) {
                state.setActiveWorktree(id)
              }
              return window.__store!.getState().activeWorktreeId
            }, workspaceId),
          { timeout: 30_000, message: `${workspaceId} never became active` }
        )
        .toBe(workspaceId)
      await ensureTerminalVisible(page)
      await waitForActiveTerminalManager(page, 30_000)
    }

    try {
      let launch = await session.launch()
      app = launch.app
      let page = launch.page
      const repoWorktreeId = await attachRepoAndOpenTerminal(page, repoPath)
      await waitForSessionReady(page)
      let workspaceId = repoWorktreeId
      if (workspaceKind === 'folder workspace') {
        workspaceId = await page.evaluate(async (dir) => {
          // Why parentPath: a folder workspace whose group has none is dropped on the next load.
          const group = await window.api.projectGroups.create({
            name: 'Closed tabs',
            parentPath: dir,
            createdFrom: 'manual'
          })
          const folder = await window.__store!.getState().createFolderWorkspace({
            projectGroupId: group.id,
            name: 'closed-tabs-folder',
            folderPath: dir
          })
          return `folder:${folder!.id}`
        }, folderPath)
      }
      await activate(page, workspaceId)
      await page.evaluate(async () => {
        await window.__store!.getState().updateSettings({
          defaultTuiAgent: 'claude',
          agentCmdOverrides: { claude: 'golden-stub-agent' },
          agentDefaultArgs: { claude: '' }
        })
      })

      const keptFirst = await openShellTab(page, workspaceId)
      const closedIdle = await openShellTab(page, workspaceId)
      const closedBusy = await openShellTab(page, workspaceId)
      const closedAgent = await openWorkingClaudeTab(app, page, workspaceId)
      const keptLast = await openShellTab(page, workspaceId)
      // Why: the repo's terminal tab predates the folder workspace and lives in another key.
      const initial = (await rendererTabIds(page, workspaceId)).filter(
        (id) => ![keptFirst, closedIdle, closedBusy, closedAgent, keptLast].includes(id)
      )

      await closeWithX(page, closedIdle, 'none')
      await closeWithX(page, closedBusy, 'running command')
      await closeWithX(page, closedAgent, 'agent')
      await expectTabs(
        page,
        session.userDataDir,
        workspaceId,
        [...initial, keptFirst, keptLast],
        'after the closes'
      )

      await session.close(app)
      app = null
      launch = await session.launch()
      app = launch.app
      page = launch.page
      await waitForSessionReady(page)
      expect(await attachRepoAndOpenTerminal(page, repoPath)).toBe(repoWorktreeId)
      await activate(page, workspaceId)
      await expectTabs(
        page,
        session.userDataDir,
        workspaceId,
        [...initial, keptFirst, keptLast],
        'after a warm restart'
      )

      // The live check saw a restored tab's first close come back too.
      await closeWithX(page, keptLast, 'none')
      await expectTabs(
        page,
        session.userDataDir,
        workspaceId,
        [...initial, keptFirst],
        'after closing a restored tab'
      )
      await session.close(app)
      app = null
      await cleanupE2EDaemons(session.userDataDir)

      launch = await session.launch()
      app = launch.app
      page = launch.page
      await waitForSessionReady(page)
      expect(await attachRepoAndOpenTerminal(page, repoPath)).toBe(repoWorktreeId)
      await activate(page, workspaceId)
      await expectTabs(
        page,
        session.userDataDir,
        workspaceId,
        [...initial, keptFirst],
        'after a cold restart'
      )
      await page.screenshot({ path: testInfo.outputPath('after-cold-restart.png') })
    } finally {
      if (app) {
        await session.close(app)
      }
      await session.dispose()
      rmSync(folderPath, { recursive: true, force: true })
    }
  })
}
