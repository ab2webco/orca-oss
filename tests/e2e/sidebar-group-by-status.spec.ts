/**
 * ORCA-1149 S3: V30's Group by. Estado splits the list into Needs you / Working / Idle from the
 * same classifier as Smart sort, and PR splits it into With PR / Without PR.
 */

import { randomUUID } from 'node:crypto'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'
import { worktreeRow } from './worktree-row-locators'

const WIDTHS = [1440, 768, 390, 320]
const WAITING_ID = 'e2e-group-by-waiting'
const WORKING_ID = 'e2e-group-by-working'
// Pane keys need a UUID leaf id or the classifier drops the entry.
const WAITING_PANE = `e2e-group-waiting:${randomUUID()}`
const WORKING_PANE = `e2e-group-working:${randomUUID()}`

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

async function seedWorktrees(page: Page): Promise<string> {
  return page.evaluate(
    ({ waitingId, workingId }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      const state = store.getState()
      const repo = state.repos[0]
      const current = repo ? (state.worktreesByRepo[repo.id] ?? [])[0] : undefined
      if (!repo || !current) {
        throw new Error('Group-by E2E needs a seeded repo and worktree')
      }
      store.setState((prev) => ({
        worktreesByRepo: {
          ...prev.worktreesByRepo,
          [repo.id]: [
            { ...current, displayName: 'Resting workspace' },
            {
              ...current,
              id: waitingId,
              displayName: 'Waiting workspace',
              isMainWorktree: false,
              branch: 'refs/heads/e2e-waiting'
            },
            {
              ...current,
              id: workingId,
              displayName: 'Working workspace',
              isMainWorktree: false,
              branch: 'refs/heads/e2e-working'
            }
          ]
        }
      }))
      const next = store.getState()
      next.setActiveView('terminal')
      next.setSidebarOpen(true)
      next.setFilterRepoIds([])
      next.setShowSleepingWorkspaces(true)
      next.setHideDefaultBranchWorkspace(false)
      return current.id
    },
    { waitingId: WAITING_ID, workingId: WORKING_ID }
  )
}

// Poll rather than set once: hydration and status sweeps can land after the seed.
async function holdAgentStatuses(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        ({ waitingId, workingId, waitingPane, workingPane }) => {
          const now = Date.now()
          const entry = (
            paneKey: string,
            worktreeId: string,
            agentState: 'waiting' | 'working'
          ) => ({
            state: agentState,
            prompt: '',
            updatedAt: now,
            stateStartedAt: now,
            paneKey,
            worktreeId,
            stateHistory: []
          })
          window.__store?.setState({
            agentStatusByPaneKey: {
              [waitingPane]: entry(waitingPane, waitingId, 'waiting'),
              [workingPane]: entry(workingPane, workingId, 'working')
            }
          })
          return Object.keys(window.__store?.getState().agentStatusByPaneKey ?? {}).length
        },
        {
          waitingId: WAITING_ID,
          workingId: WORKING_ID,
          waitingPane: WAITING_PANE,
          workingPane: WORKING_PANE
        }
      )
    )
    .toBe(2)
}

async function setGroupBy(page: Page, groupBy: 'agent-status' | 'pr-status'): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate((next) => {
        const state = window.__store?.getState()
        state?.setGroupBy(next)
        return window.__store?.getState().groupBy ?? null
      }, groupBy)
    )
    .toBe(groupBy)
}

function sectionHeaders(page: Page) {
  return page.locator('[data-worktree-sidebar] [data-worktree-sticky-header]')
}

test.describe('Sidebar group by', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  test('groups by agent status and by PR', async ({ orcaPage }, testInfo) => {
    const restingId = await seedWorktrees(orcaPage)
    await holdAgentStatuses(orcaPage)
    await setGroupBy(orcaPage, 'agent-status')

    await expect(sectionHeaders(orcaPage)).toHaveText([/Needs you/, /Working/, /Idle/])
    const waitingTop = await worktreeRow(orcaPage, WAITING_ID).boundingBox()
    const workingTop = await worktreeRow(orcaPage, WORKING_ID).boundingBox()
    const restingTop = await worktreeRow(orcaPage, restingId).boundingBox()
    expect(waitingTop && workingTop && restingTop).toBeTruthy()
    expect(waitingTop!.y).toBeLessThan(workingTop!.y)
    expect(workingTop!.y).toBeLessThan(restingTop!.y)

    await orcaPage.mouse.move(700, 400)
    for (const width of WIDTHS) {
      await orcaPage.setViewportSize({ width, height: 720 })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        await expect(sectionHeaders(orcaPage).first()).toBeVisible()
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`group-by-status-${width}-${theme}.png`)
        })
      }
    }

    // No cached PR for these branches, so every row lands in Without PR.
    await orcaPage.setViewportSize({ width: 1440, height: 720 })
    await setGroupBy(orcaPage, 'pr-status')
    await expect(sectionHeaders(orcaPage)).toHaveText([/Without PR/])
    await orcaPage.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('group-by-pr-1440-light.png')
    })
  })
})
