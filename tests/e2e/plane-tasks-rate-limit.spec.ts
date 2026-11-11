import type { PlaneConnectionStatus, PlaneProject } from '../../src/shared/plane-types'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal } from './helpers/orca-restart'
import { createShowcaseRepo } from './helpers/showcase-repo'

test.use({ seedTestRepo: false })

// ORCA-1166: while Orca's Plane limiter held a read, the Tasks page showed only a skeleton.
const WORKSPACE = {
  id: 'demo-ws',
  baseUrl: 'https://plane.example.com',
  workspaceSlug: 'lumen',
  displayName: 'Lumen Labs'
}
const STATUS: PlaneConnectionStatus = {
  connected: true,
  viewer: { id: 'demo-rowan', displayName: 'Rowan Vale', email: 'rowan@example.com' },
  workspaces: [WORKSPACE],
  activeWorkspaceId: WORKSPACE.id,
  selectedWorkspaceId: WORKSPACE.id
}
const PROJECT: PlaneProject = {
  id: 'demo-lum',
  identifier: 'LUM',
  name: 'Lumen App',
  workspaceSlug: WORKSPACE.workspaceSlug,
  workspaceId: WORKSPACE.id
}
const WIDTHS = [1440, 768, 390, 320] as const
const COPY = {
  en: {
    limit: 'Plane rate limit: waiting 42 s',
    retry: 'Plane asked to slow down: retrying in 3 s'
  },
  es: {
    limit: 'Límite de peticiones de Plane: esperando 42 s',
    retry: 'Plane pidió ir más despacio: reintentando en 3 s'
  }
}

test('names the rate-limit wait while the Tasks page loads Plane', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await attachRepoAndOpenTerminal(orcaPage, createShowcaseRepo())
  await waitForActiveWorktree(orcaPage)
  const serveWait = (wait: unknown) =>
    electronApp.evaluate(({ ipcMain }, next) => {
      ipcMain.removeHandler('plane:rateLimitWait')
      ipcMain.handle('plane:rateLimitWait', async () => next)
    }, wait)
  await electronApp.evaluate(
    ({ ipcMain }, fixture) => {
      const serve = (channel: string, value: unknown): void => {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, async () => value)
      }
      serve('plane:status', fixture.status)
      serve('plane:listProjects', [fixture.project])
      serve('plane:listStates', [])
      serve('plane:listMembers', [])
      serve('plane:listLabels', [])
      // Why never settles: the page stays in its loading state for the capture.
      ipcMain.removeHandler('plane:listWorkItems')
      ipcMain.handle('plane:listWorkItems', () => new Promise(() => {}))
    },
    { status: STATUS, project: PROJECT }
  )
  await serveWait(null)
  await orcaPage.evaluate(
    async ({ workspaceSlug, projectId }) => {
      const store = window.__store!
      const settings = await window.api.settings.set({
        defaultPlaneSelection: { workspaceSlug, projectId },
        planeViewMode: 'list'
      })
      store.setState({ settings })
      await store.getState().checkPlaneConnection(true)
      store.getState().openTaskPage({ taskSource: 'plane' })
    },
    { workspaceSlug: WORKSPACE.workspaceSlug, projectId: PROJECT.id }
  )
  const notice = orcaPage.getByRole('status').filter({ hasText: /Plane/ })
  await orcaPage.waitForTimeout(1_500)
  await expect(notice).toHaveCount(0)

  // Why: at narrow widths the search ran past its card, the heading wrapped over it, and refresh sat alone.
  for (const width of [390, 320]) {
    await electronApp.evaluate(({ BrowserWindow }, w) => {
      BrowserWindow.getAllWindows()[0]?.setSize(w, 900)
    }, width)
    await orcaPage.waitForTimeout(400)
    const search = await orcaPage.getByPlaceholder('Search work items by ID or title').boundingBox()
    const card = await orcaPage
      .getByPlaceholder('Search work items by ID or title')
      .locator('xpath=ancestor::div[contains(@class,"rounded-b-none")][1]')
      .boundingBox()
    const heading = await orcaPage.getByText('Plane work items', { exact: true }).boundingBox()
    const refresh = await orcaPage
      .getByRole('button', { name: 'Refresh Plane work items' })
      .boundingBox()
    const firstPreset = await orcaPage
      .getByRole('button', { name: 'All', exact: true })
      .boundingBox()
    expect(search!.x + search!.width).toBeLessThanOrEqual(card!.x + card!.width)
    expect(heading!.height).toBeLessThan(20)
    expect(Math.abs(refresh!.y - firstPreset!.y)).toBeLessThan(refresh!.height)
  }
  const capture = process.env.ORCA_E2E_CAPTURE === '1'
  const shoot = async (name: string): Promise<void> => {
    if (!capture) {
      return
    }
    for (const width of WIDTHS) {
      await electronApp.evaluate(({ BrowserWindow }, w) => {
        BrowserWindow.getAllWindows()[0]?.setSize(w, 900)
      }, width)
      await orcaPage.waitForTimeout(400)
      await orcaPage.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`) })
    }
  }
  await shoot('before-no-notice-light')

  for (const language of ['en', 'es'] as const) {
    await orcaPage.evaluate(
      (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
      language
    )
    await serveWait({ reason: 'limit', waitMs: 41_200 })
    await expect(notice).toHaveText(COPY[language].limit, { timeout: 5_000 })
    for (const theme of ['dark', 'light'] as const) {
      await orcaPage.evaluate(
        (next) => window.__store!.getState().updateSettings({ theme: next }),
        theme
      )
      await shoot(`after-limit-${language}-${theme}`)
    }
    await serveWait({ reason: 'retry', waitMs: 3_000 })
    await expect(notice).toHaveText(COPY[language].retry, { timeout: 5_000 })
    await shoot(`after-retry-${language}-light`)
  }
})
