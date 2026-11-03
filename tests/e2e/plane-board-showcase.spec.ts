import type {
  PlaneConnectionStatus,
  PlaneMember,
  PlaneProject,
  PlaneState,
  PlaneUser,
  PlaneWorkItem,
  PlaneWorkItemPriority
} from '../../src/shared/plane-types'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal } from './helpers/orca-restart'
import { CLIP_ARGS, showcaseClip } from './helpers/showcase-clip'
import { createShowcaseRepo } from './helpers/showcase-repo'

test.use({ seedTestRepo: false, orcaAppExtraArgs: CLIP_ARGS })

// The README and site Plane clip. Workspace, project, people and work
// items are invented demo data, served by replacing the Plane IPC handlers.
// Wide enough, with the sidebar closed, for all four columns at once.
const WINDOW_WIDTH = 1440
const WINDOW_HEIGHT = 900
const HOLD_MS = 2_000

const WORKSPACE = {
  id: 'demo-ws',
  baseUrl: 'https://plane.example.com',
  workspaceSlug: 'lumen',
  displayName: 'Lumen Labs'
}
const VIEWER: PlaneUser = { id: 'demo-rowan', displayName: 'Rowan Vale' }
const STATUS: PlaneConnectionStatus = {
  connected: true,
  viewer: { ...VIEWER, email: 'rowan@example.com' },
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
const STATES: PlaneState[] = [
  { id: 'demo-todo', name: 'Todo', group: 'unstarted', sequence: 1, color: '#3B82F6' },
  { id: 'demo-doing', name: 'In Progress', group: 'started', sequence: 2, color: '#F59E0B' },
  { id: 'demo-review', name: 'In Review', group: 'started', sequence: 3, color: '#A855F7' },
  { id: 'demo-done', name: 'Done', group: 'completed', sequence: 4, color: '#22C55E' }
]
const PEOPLE: PlaneUser[] = [
  VIEWER,
  { id: 'demo-wren', displayName: 'Wren Ito' },
  { id: 'demo-pico', displayName: 'Pico Hale' }
]
const MEMBERS: PlaneMember[] = PEOPLE.map(({ id, displayName }) => ({ id, displayName }))
const iso = new Date().toISOString()
const item = (
  sequenceId: number,
  title: string,
  state: number,
  priority: PlaneWorkItemPriority,
  assignee: number
): PlaneWorkItem => ({
  id: `demo-item-${sequenceId}`,
  identifier: `LUM-${sequenceId}`,
  sequenceId,
  title,
  url: `https://plane.example.com/lumen/browse/LUM-${sequenceId}/`,
  project: PROJECT,
  state: STATES[state]!,
  labels: [],
  assignees: [PEOPLE[assignee]!],
  priority,
  updatedAt: iso,
  createdAt: iso
})
const ITEMS: PlaneWorkItem[] = [
  item(16, 'Export the weekly report as CSV', 0, 'low', 2),
  item(17, 'Keyboard shortcuts for the editor', 0, 'medium', 1),
  item(12, 'Dark mode toggle', 1, 'high', 1),
  item(14, 'Offline cache for the feed', 1, 'urgent', 2),
  item(15, 'Onboarding copy', 2, 'medium', 0),
  item(11, 'Fix login redirect loop', 3, 'high', 0)
]

test('shows a Plane project as a board with its states as columns', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await attachRepoAndOpenTerminal(orcaPage, createShowcaseRepo())
  await waitForActiveWorktree(orcaPage)
  await electronApp.evaluate(
    ({ BrowserWindow, ipcMain }, { size, fixture }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height)
      const serve = (channel: string, value: unknown): void => {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, async () => value)
      }
      serve('plane:status', fixture.status)
      serve('plane:listProjects', [fixture.project])
      serve('plane:listStates', fixture.states)
      serve('plane:listWorkItems', fixture.items)
      serve('plane:listMembers', fixture.members)
      serve('plane:listLabels', [])
    },
    {
      size: { width: WINDOW_WIDTH, height: WINDOW_HEIGHT },
      fixture: { status: STATUS, project: PROJECT, states: STATES, items: ITEMS, members: MEMBERS }
    }
  )
  await orcaPage.evaluate(
    async ({ workspaceSlug, projectId }) => {
      const store = window.__store!
      const settings = await window.api.settings.set({
        theme: 'dark',
        defaultPlaneSelection: { workspaceSlug, projectId },
        planeViewMode: 'board'
      })
      store.setState({ settings })
      store.getState().setSidebarOpen(false)
      await store.getState().checkPlaneConnection(true)
      store.getState().openTaskPage({ taskSource: 'plane' })
    },
    { workspaceSlug: WORKSPACE.workspaceSlug, projectId: PROJECT.id }
  )

  for (const state of STATES) {
    await expect(
      orcaPage.getByRole('button', { name: `Reorder ${state.name} column` })
    ).toBeVisible({ timeout: 15_000 })
  }
  for (const workItem of ITEMS) {
    await expect(orcaPage.getByText(workItem.title)).toBeInViewport()
  }
  // A first-run sidebar hint stays open for 12 s.
  await expect(orcaPage.getByText('Workspace board moved to the bottom bar')).toBeHidden({
    timeout: 20_000
  })

  // Why: each beat holds long enough to read before the next action.
  const hold = () => orcaPage.waitForTimeout(HOLD_MS)
  const clip = await showcaseClip(electronApp, testInfo, 'plane-board')
  await hold()

  await orcaPage.getByLabel('List', { exact: true }).click()
  for (const workItem of ITEMS) {
    await expect(orcaPage.getByText(workItem.title)).toBeVisible()
  }
  await hold()
  await orcaPage.waitForTimeout(1_500)
  await clip.stop()
})
