import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { cleanupE2EDaemons } from './helpers/electron-process-shutdown'

// ORCA-1141 R10: a folder workspace under a group with no parentPath, made the way the live
// check made it, vanished on the next load while its group and tab records stayed on disk.

function persistedFolderIds(userDataDir: string): string[] | null {
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
    folderWorkspaces?: { id: string }[]
  }
  return (data.folderWorkspaces ?? []).map((one) => one.id)
}

async function rendererState(
  page: Page,
  workspaceId: string
): Promise<{ folders: string[]; tabs: string[] }> {
  return page.evaluate((id) => {
    const state = window.__store!.getState()
    return {
      folders: state.folderWorkspaces.map((one) => one.id),
      tabs: (state.tabsByWorktree[id] ?? []).map((tab) => tab.id).sort()
    }
  }, workspaceId)
}

test('a folder workspace under a group with no parentPath comes back after a cold restart', async ({
  flushRendererRecoveryEvidenceQueue
}, testInfo) => {
  void flushRendererRecoveryEvidenceQueue
  test.setTimeout(240_000)
  const repoPath = readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
  const folderPath = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-folder-restart-'))
  const session = createRestartSession(testInfo)
  let app: ElectronApplication | null = null
  try {
    let launch = await session.launch()
    app = launch.app
    let page = launch.page
    await attachRepoAndOpenTerminal(page, repoPath)
    await waitForSessionReady(page)
    // The live check's calls: a group named by the store's one-argument create, then the folder.
    const folderId = await page.evaluate(async (dir) => {
      const store = window.__store!.getState()
      const group = await store.createProjectGroup('folder-check')
      const folder = await window.__store!.getState().createFolderWorkspace({
        projectGroupId: group!.id,
        name: 'folder-ws',
        folderPath: dir
      })
      return folder!.id
    }, folderPath)
    const workspaceId = `folder:${folderId}`
    await page.evaluate((id) => window.__store!.getState().setActiveWorktree(id), workspaceId)
    await ensureTerminalVisible(page)
    const tabId = await page.evaluate(
      (id) => window.__store!.getState().createTab(id, undefined, undefined, { activate: true }).id,
      workspaceId
    )
    await expect
      .poll(() => persistedFolderIds(session.userDataDir), { timeout: 15_000 })
      .toContain(folderId)

    await expect(page.getByText('folder-check', { exact: true })).toHaveCount(1)
    await session.close(app)
    app = null
    await cleanupE2EDaemons(session.userDataDir)
    launch = await session.launch()
    app = launch.app
    page = launch.page
    await waitForSessionReady(page)

    await expect
      .poll(async () => (await rendererState(page, workspaceId)).folders, {
        timeout: 30_000,
        message: 'the folder workspace never came back to the renderer'
      })
      .toContain(folderId)
    await expect
      .poll(async () => (await rendererState(page, workspaceId)).tabs, { timeout: 30_000 })
      .toContain(tabId)
    expect(persistedFolderIds(session.userDataDir)).toContain(folderId)
    // Its restored tab runs a shell again, where the live check got selector_not_found.
    await page.evaluate((id) => window.__store!.getState().setActiveWorktree(id), workspaceId)
    await ensureTerminalVisible(page)
    await expect
      .poll(
        () => page.evaluate((id) => window.__store!.getState().ptyIdsByTabId[id]?.[0] ?? '', tabId),
        { timeout: 30_000, message: "the folder's restored tab never got a PTY" }
      )
      .not.toBe('')
    // The sidebar draws the group as it did before the restart.
    await expect(page.getByText('folder-check', { exact: true })).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath('after-cold-restart.png') })
  } finally {
    if (app) {
      await session.close(app)
    }
    await session.dispose()
    rmSync(folderPath, { recursive: true, force: true })
  }
})
