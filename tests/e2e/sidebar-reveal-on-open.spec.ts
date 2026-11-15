/**
 * ORCA-1216 §8 / ORCA-1192: opening a terminal brings its workspace row into view without taking
 * focus, and after a restore the active workspace is revealed and named on the Retomar strip.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'
import { dismissWorkspaceBoardMovedHint } from './helpers/workspace-board-moved-hint'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'

const WIDTHS = [1440, 768, 390, 320]
const PREFIX = 'e2e-rv-'
const TARGET_REPO = `${PREFIX}zz-destino`
const TARGET_WORKTREE = `${TARGET_REPO}-feature`
const TARGET_GROUP = `${PREFIX}zz-carpetas`
const TARGET_FOLDER = `folder:${PREFIX}borradores`

const sidebarWidthFor = (width: number): number => (width >= 1440 ? 470 : width > 320 ? 280 : 220)

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

async function setWidth(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: width >= 1440 ? 900 : 760 })
  await page.evaluate((w) => {
    const store = window.__store!.getState()
    store.setSidebarWidth(w)
    store.setRightSidebarOpen(false)
  }, sidebarWidthFor(width))
}

/** True when the row is drawn inside the sidebar's scroll viewport. */
async function rowInView(page: Page, worktreeId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const scroller = document.querySelector<HTMLElement>('[data-worktree-sidebar]')
    const row = [...document.querySelectorAll<HTMLElement>('[data-worktree-id]')].find(
      (candidate) => candidate.dataset.worktreeId === id
    )
    if (!scroller || !row) {
      return false
    }
    const box = row.getBoundingClientRect()
    const view = scroller.getBoundingClientRect()
    return box.height > 0 && box.top >= view.top - 1 && box.bottom <= view.bottom + 1
  }, worktreeId)
}

/** Folds the projects behind the given headers (by the key each header renders), then scrolls to the top. */
async function hideTargets(page: Page, headerSelectors: string[]): Promise<string[]> {
  const keys: string[] = []
  for (const selector of headerSelectors) {
    // Why: the list is virtualized, so walk it down from the top until the header is mounted.
    await page.locator('[data-worktree-sidebar]').evaluate((element) => {
      element.scrollTop = 0
    })
    let key: string | null = null
    await expect
      .poll(
        async () => {
          key = await page.evaluate((headerSelector) => {
            const scroller = document.querySelector<HTMLElement>('[data-worktree-sidebar]')!
            const header = scroller.querySelector<HTMLElement>(headerSelector)
            if (header) {
              return decodeURIComponent(header.id.replace(/^worktree-list-option-/, ''))
            }
            scroller.scrollTop += scroller.clientHeight / 2
            scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
            return null
          }, selector)
          return key !== null
        },
        { timeout: 20_000, message: `${selector} never mounted` }
      )
      .toBe(true)
    if (key === null) {
      throw new Error(`${selector} never mounted`)
    }
    await page.evaluate((groupKey) => {
      const store = window.__store!.getState()
      if (!store.collapsedGroups.has(groupKey)) {
        store.toggleCollapsedGroup(groupKey)
      }
    }, key)
    keys.push(key)
  }
  await page.locator('[data-worktree-sidebar]').evaluate((element) => {
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  return keys
}

/** True when the row is not in the DOM at all, i.e. its project is really folded. */
async function rowFolded(page: Page, worktreeId: string): Promise<boolean> {
  return page.evaluate(
    (id) =>
      ![
        ...document.querySelectorAll<HTMLElement>('[data-worktree-sidebar] [data-worktree-id]')
      ].some((row) => row.dataset.worktreeId === id),
    worktreeId
  )
}

/** 18 filler projects before the targets, a collapsed target project and a collapsed folder group. */
async function seedManyProjects(page: Page): Promise<{ realRepoId: string }> {
  return page.evaluate(
    ({ prefix, targetRepo, targetGroup, targetFolder }) => {
      const store = window.__store!
      const state = store.getState()
      const sourceRepo = state.repos[0]
      const sourceWorktree = sourceRepo
        ? (state.worktreesByRepo[sourceRepo.id] ?? [])[0]
        : undefined
      if (!sourceRepo || !sourceWorktree) {
        throw new Error('Reveal E2E needs the seeded repo')
      }
      const now = Date.now()
      const repos = [...state.repos]
      const worktreesByRepo = { ...state.worktreesByRepo }
      worktreesByRepo[sourceRepo.id] = (worktreesByRepo[sourceRepo.id] ?? []).map((w) => ({
        ...w,
        lastActivityAt: now - 5 * 60_000
      }))
      const add = (id: string, name: string, branches: string[]) => {
        repos.push({
          ...sourceRepo,
          id,
          path: `${sourceRepo.path}-${id}`,
          displayName: name,
          connectionId: null,
          executionHostId: undefined
        })
        worktreesByRepo[id] = branches.map((branch, n) => ({
          ...sourceWorktree,
          id: `${id}-${branch}`,
          repoId: id,
          path: `${sourceWorktree.path}-${id}-${branch}`,
          displayName: branch,
          branch: `refs/heads/${branch}`,
          isMainWorktree: n === 0,
          isArchived: false,
          isPinned: false,
          lastActivityAt: now - (n + 2) * 60_000
        }))
      }
      for (let n = 1; n <= 18; n++) {
        const name = `a-proyecto-${String(n).padStart(2, '0')}`
        add(`${prefix}${name}`, name, ['main', 'trabajo'])
      }
      add(targetRepo, 'zz-destino', ['main', 'feature'])
      const folderId = targetFolder.slice('folder:'.length)
      store.setState({
        repos,
        worktreesByRepo,
        projectGroups: [
          ...state.projectGroups,
          {
            id: targetGroup,
            name: 'zz-carpetas',
            parentPath: '/tmp/e2e-rv-zz-carpetas',
            parentGroupId: null,
            createdFrom: 'manual',
            tabOrder: 99,
            isCollapsed: false,
            color: null,
            createdAt: now,
            updatedAt: now
          }
        ],
        folderWorkspaces: [
          ...state.folderWorkspaces,
          {
            id: folderId,
            projectGroupId: targetGroup,
            name: 'borradores',
            folderPath: '/tmp/e2e-rv-borradores',
            linkedTask: null,
            comment: '',
            isArchived: false,
            isUnread: false,
            isPinned: false,
            sortOrder: 0,
            lastActivityAt: now - 60_000,
            createdAt: now,
            updatedAt: now
          }
        ]
      })
      const next = store.getState()
      next.setActiveView('terminal')
      next.setSidebarOpen(true)
      next.setSidebarWidth(470)
      next.setRightSidebarOpen(false)
      next.setGroupBy('repo')
      next.setProjectOrderBy('name')
      next.setFilterRepoIds([])
      return { realRepoId: sourceRepo.id }
    },
    {
      prefix: PREFIX,
      targetRepo: TARGET_REPO,
      targetGroup: TARGET_GROUP,
      targetFolder: TARGET_FOLDER
    }
  )
}

/** The payload main sends the renderer for `orca terminal create` (no --focus) and for a member launch. */
async function sendCreateTerminal(
  app: ElectronApplication,
  payload: { worktreeId: string; title: string; surfaceOwner?: false }
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, data) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    if (!window) {
      throw new Error('Orca BrowserWindow is unavailable')
    }
    window.webContents.send('ui:createTerminal', { ...data, activate: false })
  }, payload)
}

async function focusTypingProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector('[data-e2e-typing-probe]')?.remove()
    const input = document.createElement('input')
    input.setAttribute('data-e2e-typing-probe', '')
    input.style.cssText = 'position:fixed;right:8px;bottom:8px;width:120px;z-index:1;opacity:0.01'
    document.body.append(input)
    input.focus()
  })
  await page.keyboard.type('abc')
}

async function typingProbeState(page: Page): Promise<{ focused: boolean; value: string }> {
  return page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[data-e2e-typing-probe]')
    return { focused: document.activeElement === input, value: input?.value ?? '' }
  })
}

test('opening a terminal brings its row into view without taking focus (ORCA-1192)', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  test.setTimeout(240_000)
  await waitForSessionReady(orcaPage)
  const activeWorktreeId = await waitForActiveWorktree(orcaPage)
  await writeSettings(orcaPage, { uiLanguage: 'es', sidebarActivityWindowHours: 24 })
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await setTheme(orcaPage, 'dark')
  const { realRepoId } = await seedManyProjects(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await dismissWorkspaceBoardMovedHint(orcaPage)

  const targetGroups = [
    `[data-repo-header-id="${TARGET_REPO}"]`,
    `[data-project-group-header-id="${TARGET_GROUP}"]`
  ]
  const foldedKeys = await hideTargets(orcaPage, targetGroups)
  const isCollapsed = (key: string): Promise<boolean> =>
    orcaPage.evaluate((k) => window.__store!.getState().collapsedGroups.has(k), key)
  expect(await isCollapsed(foldedKeys[0])).toBe(true)
  const overflow = await orcaPage
    .locator('[data-worktree-sidebar]')
    .evaluate((element) => element.scrollHeight - element.clientHeight)
  expect(overflow, 'the sidebar must scroll for this to prove anything').toBeGreaterThan(200)
  expect(await rowInView(orcaPage, TARGET_WORKTREE)).toBe(false)
  expect(await rowInView(orcaPage, TARGET_FOLDER)).toBe(false)
  const before = await orcaPage.evaluate(() => {
    const s = window.__store!.getState()
    return { groupBy: s.groupBy, filterRepoIds: s.filterRepoIds, order: s.projectOrderBy }
  })

  // CLI `orca terminal create` into a collapsed, off-screen project while the person types.
  await focusTypingProbe(orcaPage)
  await sendCreateTerminal(electronApp, { worktreeId: TARGET_WORKTREE, title: 'cli' })
  await expect.poll(() => rowInView(orcaPage, TARGET_WORKTREE), { timeout: 15_000 }).toBe(true)
  await orcaPage.keyboard.type('def')
  expect(await typingProbeState(orcaPage)).toEqual({ focused: true, value: 'abcdef' })
  expect(await isCollapsed(foldedKeys[0]), 'the reveal unfolds the project').toBe(false)
  expect(
    await orcaPage.evaluate(() => {
      const s = window.__store!.getState()
      return {
        active: s.activeWorktreeId,
        groupBy: s.groupBy,
        filterRepoIds: s.filterRepoIds,
        order: s.projectOrderBy
      }
    })
  ).toEqual({ active: activeWorktreeId, ...before })
  await orcaPage.mouse.move(1000, 600)
  await orcaPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('reveal-cli-1440-dark.png')
  })

  // A lead member launch (surfaceOwner: false) into a folder workspace, also folded away.
  await hideTargets(orcaPage, targetGroups)
  expect(await rowInView(orcaPage, TARGET_FOLDER)).toBe(false)
  await focusTypingProbe(orcaPage)
  await sendCreateTerminal(electronApp, {
    worktreeId: TARGET_FOLDER,
    title: 'member',
    surfaceOwner: false
  })
  await expect.poll(() => rowInView(orcaPage, TARGET_FOLDER), { timeout: 15_000 }).toBe(true)
  expect(await typingProbeState(orcaPage)).toEqual({ focused: true, value: 'abc' })
  expect(await isCollapsed(foldedKeys[1]), 'the reveal unfolds the folder group').toBe(false)
  expect(await orcaPage.evaluate(() => window.__store!.getState().activeWorktreeId)).toBe(
    activeWorktreeId
  )
  await orcaPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('reveal-member-folder-1440-dark.png')
  })

  // The tab bar's + menu, with the active workspace's own project folded and scrolled away.
  const [realKey] = await hideTargets(orcaPage, [`[data-repo-header-id="${realRepoId}"]`])
  expect(await isCollapsed(realKey)).toBe(true)
  await expect.poll(() => rowInView(orcaPage, activeWorktreeId)).toBe(false)
  await orcaPage.getByRole('button', { name: 'Nueva pestaña' }).first().click({ force: true })
  await orcaPage
    .getByRole('menuitem', { name: /Nuevo terminal/i })
    .first()
    .click()
  await expect.poll(() => rowInView(orcaPage, activeWorktreeId), { timeout: 15_000 }).toBe(true)
  expect(await isCollapsed(realKey)).toBe(false)

  // Every width and theme: a CLI open from the top of the list lands with the row on screen.
  for (const width of WIDTHS) {
    await setWidth(orcaPage, width)
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(orcaPage, theme)
      const where = `${width}px ${theme}`
      await hideTargets(orcaPage, targetGroups)
      expect(await rowInView(orcaPage, TARGET_WORKTREE), where).toBe(false)
      await sendCreateTerminal(electronApp, { worktreeId: TARGET_WORKTREE, title: where })
      await expect
        .poll(() => rowInView(orcaPage, TARGET_WORKTREE), { timeout: 15_000, message: where })
        .toBe(true)
      const sideways = await orcaPage
        .locator('[data-worktree-sidebar]')
        .evaluate((node) => node.scrollWidth - node.clientWidth)
      expect(sideways, `sidebar scrolls sideways at ${where}`).toBeLessThanOrEqual(0)
      await orcaPage.mouse.move(width - 5, 700)
      await orcaPage.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(`reveal-cli-${width}-${theme}.png`)
      })
    }
  }
})

/** The restored session's active workspace, as the renderer sees it. */
async function activeWorkspace(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const s = window.__store!.getState()
    return s.activeWorkspaceKey?.startsWith('folder:') ? s.activeWorkspaceKey : s.activeWorktreeId
  })
}

test('a restore reveals the active workspace and names it on the Retomar strip', async ({
  flushRendererRecoveryEvidenceQueue
}, testInfo) => {
  void flushRendererRecoveryEvidenceQueue
  test.setTimeout(420_000)
  const repoPath = readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
  const folderRoot = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-retomar-'))
  const session = createRestartSession(testInfo)
  let app: ElectronApplication | null = null
  try {
    let launch = await session.launch()
    app = launch.app
    let page = launch.page
    const targetId = await attachRepoAndOpenTerminal(page, repoPath)
    await waitForSessionReady(page)
    await writeSettings(page, { uiLanguage: 'es', sidebarActivityWindowHours: 24 })
    // 40 real folder projects sort before the repo, so its row starts below the fold even in the tall launch window.
    const folders = Array.from({ length: 40 }, (_, n) =>
      mkdtempSync(path.join(folderRoot, `a-carpeta-${String(n).padStart(2, '0')}-`))
    )
    const fillerId = await page.evaluate(async (dirs) => {
      let first: string | null = null
      for (const [n, dir] of dirs.entries()) {
        const name = `a-carpeta-${String(n).padStart(2, '0')}`
        const group = await window.__store!.getState().createProjectGroup(name)
        const folder = await window.__store!.getState().createFolderWorkspace({
          projectGroupId: group!.id,
          name: `${name}-ws`,
          folderPath: dir
        })
        first ??= `folder:${folder!.id}`
      }
      return first
    }, folders)
    const { repoId, display } = await page.evaluate((id) => {
      const s = window.__store!.getState()
      s.setGroupBy('repo')
      s.setProjectOrderBy('name')
      const worktree = Object.values(s.worktreesByRepo)
        .flat()
        .find((one) => one.id === id)!
      const repo = s.repos.find((one) => one.id === worktree.repoId)!
      const name = worktree.displayName || worktree.branch.replace(/^refs\/heads\//, '')
      return { repoId: repo.id, display: `${repo.displayName} · ${name}` }
    }, targetId)
    const [repoKey] = await hideTargets(page, [`[data-repo-header-id="${repoId}"]`])
    expect(await rowFolded(page, targetId)).toBe(true)
    await expect.poll(() => activeWorkspace(page)).toBe(targetId)
    await expect
      .poll(async () =>
        page.evaluate(async () => (await window.api.ui.get()).collapsedGroups ?? [])
      )
      .toContain(repoKey)

    const relaunch = async (): Promise<Page> => {
      await session.close(app!)
      app = null
      launch = await session.launch()
      app = launch.app
      const next = launch.page
      await waitForSessionReady(next)
      return next
    }

    page = await relaunch()
    const strip = page.locator('[data-resume-strip]')
    await expect(strip).toBeVisible({ timeout: 30_000 })
    await expect(strip.locator('[data-resume-strip-label]')).toHaveText('Retomar')
    await expect(strip.locator('[data-resume-strip-target]')).toHaveText(display)
    await expect(strip.locator('[data-activity-age]')).toBeVisible()
    await expect.poll(() => rowInView(page, targetId), { timeout: 15_000 }).toBe(true)
    // The reveal scrolled past the folder projects and unfolded the repo without focusing the list.
    expect(
      await page.locator('[data-worktree-sidebar]').evaluate((node) => node.scrollTop)
    ).toBeGreaterThan(0)
    expect(
      await page.evaluate(() => Boolean(document.activeElement?.closest('[data-worktree-sidebar]')))
    ).toBe(false)
    expect(
      await page.evaluate((key) => window.__store!.getState().collapsedGroups.has(key), repoKey)
    ).toBe(false)
    await dismissWorkspaceBoardMovedHint(page)

    for (const width of WIDTHS) {
      await setWidth(page, width)
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(page, theme)
        const where = `${width}px ${theme}`
        await expect(strip, where).toBeVisible()
        const fit = await strip.evaluate((node) => {
          const sidebar = node.closest<HTMLElement>('[data-worktree-sidebar-root]')!
          const box = node.getBoundingClientRect()
          const bounds = sidebar.getBoundingClientRect()
          return { left: box.left - bounds.left, right: bounds.right - box.right }
        })
        expect(fit.left, `strip escapes the sidebar at ${where}`).toBeGreaterThanOrEqual(0)
        expect(fit.right, `strip escapes the sidebar at ${where}`).toBeGreaterThanOrEqual(0)
        // Why: a resize remounts the virtual rows; ask for the same reveal the restore made.
        await page.evaluate(
          (id) => window.__store!.getState().revealWorktreeInSidebar(id, { behavior: 'auto' }),
          targetId
        )
        await expect.poll(() => rowInView(page, targetId), { message: where }).toBe(true)
        await page.mouse.move(width - 5, 700)
        await page.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`retomar-${width}-${theme}.png`)
        })
      }
    }

    // Click: from another workspace with the list scrolled away, the strip goes back and goes away.
    await setWidth(page, 1440)
    await page.evaluate((id) => window.__store!.getState().setActiveWorktree(id), fillerId!)
    await expect.poll(() => activeWorkspace(page)).toBe(fillerId)
    await hideTargets(page, [`[data-repo-header-id="${repoId}"]`])
    await expect.poll(() => rowInView(page, targetId)).toBe(false)
    await strip.locator('[data-resume-strip-open]').click()
    await expect.poll(() => activeWorkspace(page)).toBe(targetId)
    await expect(strip).toHaveCount(0)
    await expect.poll(() => rowInView(page, targetId), { timeout: 15_000 }).toBe(true)

    // ×: the next restore shows it again; dismissing it changes nothing else.
    page = await relaunch()
    const restoredStrip = page.locator('[data-resume-strip]')
    await expect(restoredStrip).toBeVisible({ timeout: 30_000 })
    const activeBefore = await activeWorkspace(page)
    await restoredStrip.locator('[data-resume-strip-dismiss]').click()
    await expect(restoredStrip).toHaveCount(0)
    expect(await activeWorkspace(page)).toBe(activeBefore)
  } finally {
    if (app) {
      await session.close(app)
    }
    await session.dispose()
    rmSync(folderRoot, { recursive: true, force: true })
  }
})
