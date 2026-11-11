import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

// ORCA-1166: list grids chose columns by window width, but the sidebar makes the pane narrower.
const WIDTHS = [768, 1024, 1440] as const

const LINEAR_WORKSPACE = {
  id: 'linear-workspace-a',
  displayName: 'Linear E2E User',
  email: 'linear-e2e@example.test',
  organizationId: 'linear-org-a',
  organizationName: 'Alpha Workspace'
}
const LINEAR_TEAM = {
  id: 'linear-team-a',
  name: 'Engineering',
  key: 'ENG',
  workspaceId: LINEAR_WORKSPACE.id,
  workspaceName: LINEAR_WORKSPACE.organizationName
}
const LINEAR_ISSUE = {
  id: 'linear-issue-a',
  workspaceId: LINEAR_WORKSPACE.id,
  identifier: 'ENG-100',
  title: 'Keep the list readable next to the sidebar',
  url: 'https://linear.example.test/ENG-100',
  state: { name: 'In Review', type: 'started', color: '#888888' },
  team: { id: LINEAR_TEAM.id, name: LINEAR_TEAM.name, key: LINEAR_TEAM.key },
  labels: [],
  labelIds: [],
  priority: 2,
  updatedAt: '2026-08-04T18:00:00.000Z'
}

/** Every visible uppercase grid header: each labelled cell is wide enough and keeps its label inside. */
async function headerProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = []
    for (const row of document.querySelectorAll<HTMLElement>('.grid.uppercase')) {
      if (row.getBoundingClientRect().width === 0 || getComputedStyle(row).display === 'none') {
        continue
      }
      for (const cell of row.children) {
        const label = cell.textContent?.trim()
        const box = cell.getBoundingClientRect()
        if (!label || getComputedStyle(cell).display === 'none') {
          continue
        }
        // Why scroll sizes, not height: grid cells stretch to the row, so a tall cell is not a wrapped label.
        const spills =
          cell.scrollWidth > cell.clientWidth + 1 || cell.scrollHeight > cell.clientHeight + 1
        if (box.width < 24 || spills) {
          problems.push(`${label} (${Math.round(box.width)} px)`)
        }
      }
    }
    return problems
  })
}

async function checkWidths(electronApp: ElectronApplication, page: Page): Promise<void> {
  for (const width of WIDTHS) {
    await electronApp.evaluate(({ BrowserWindow }, w) => {
      BrowserWindow.getAllWindows()[0]?.setSize(w, 900)
    }, width)
    await page.waitForTimeout(400)
    if (process.env.ORCA_E2E_CAPTURE === '1') {
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate(
          (next) => window.__store!.getState().updateSettings({ theme: next }),
          theme
        )
        await page.waitForTimeout(300)
        await page.screenshot({ path: test.info().outputPath(`list-${width}-${theme}.png`) })
      }
    }
    expect(await headerProblems(page), `collapsed headers at ${width}`).toEqual([])
  }
}

test('GitHub task list headers fit a pane narrowed by the sidebar', async ({
  electronApp,
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await orcaPage.evaluate(() => {
    const store = window.__store!
    const repos = store.getState().repos.map((repo, index) =>
      index === 0
        ? {
            ...repo,
            gitRemoteIdentity: {
              canonicalKey: 'github.com/example/repo',
              remoteName: 'origin',
              remoteUrl: 'https://github.com/example/repo.git'
            }
          }
        : repo
    )
    const items = Array.from({ length: 5 }, (_, index) => ({
      id: `issue-${index + 1}`,
      type: 'issue' as const,
      number: index + 1,
      title: `Keep the list readable next to the sidebar ${index + 1}`,
      state: 'open' as const,
      url: `https://github.com/example/repo/issues/${index + 1}`,
      labels: [],
      updatedAt: new Date(1_700_000_000_000 - index * 1_000).toISOString(),
      author: 'octocat',
      repoId: repos[0]?.id ?? 'repo-1'
    }))
    store.setState({
      repos,
      getCachedWorkItems: () => items,
      prefetchWorkItems: () => {},
      fetchWorkItemsAcrossRepos: async () => ({ items, failedCount: 0, githubUnavailable: false }),
      countWorkItemsAcrossRepos: async () => ({ totalCount: 5, totalPages: 1 })
    })
    store.getState().openTaskPage({ taskSource: 'github' })
  })
  await expect(orcaPage.getByText('Keep the list readable next to the sidebar 1')).toBeVisible({
    timeout: 15_000
  })
  await checkWidths(electronApp, orcaPage)
})

test('Linear issue list headers fit a pane narrowed by the sidebar', async ({
  electronApp,
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await electronApp.evaluate(
    ({ ipcMain }, fixture) => {
      const serve = (channel: string, value: unknown): void => {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, async () => value)
      }
      const status = {
        connected: true,
        viewer: fixture.workspace,
        workspaces: [fixture.workspace],
        activeWorkspaceId: fixture.workspace.id,
        selectedWorkspaceId: fixture.workspace.id
      }
      serve('linear:status', status)
      serve('linear:selectWorkspace', status)
      serve('linear:listTeams', [fixture.team])
      serve('linear:listIssues', { items: [fixture.issue], hasMore: false })
      serve('linear:teamStates', [])
      serve('linear:teamLabels', [])
      serve('linear:teamMembers', [])
    },
    { workspace: LINEAR_WORKSPACE, team: LINEAR_TEAM, issue: LINEAR_ISSUE }
  )
  await orcaPage.evaluate(async () => {
    const store = window.__store!
    await store.getState().checkLinearConnection(true)
    store.getState().openTaskPage({ taskSource: 'linear' })
  })
  await expect(orcaPage.getByText(LINEAR_ISSUE.title, { exact: true })).toBeVisible({
    timeout: 15_000
  })
  await checkWidths(electronApp, orcaPage)
})
