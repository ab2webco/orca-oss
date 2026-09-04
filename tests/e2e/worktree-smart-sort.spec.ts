import { test, expect } from './helpers/orca-app'
import type { Page } from '@stablyai/playwright-test'
import type { TerminalPaneLayoutNode } from '../../src/shared/terminal-tab-types'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { worktreeRow } from './worktree-row-locators'

type SmartSortScenario = {
  blockedId: string
  doneId: string
  blockedTabId: string
  doneTabId: string
  blockedPaneKey: string
  donePaneKey: string
}

async function getVisibleWorktreeIdsByVirtualIndex(page: Page): Promise<string[]> {
  return page
    .locator('[data-worktree-sidebar] [role="option"][data-worktree-id]')
    .evaluateAll((elements) =>
      elements
        .map((element) => ({
          id: element.dataset.worktreeId ?? '',
          index: Number.parseInt(
            element.closest('[data-worktree-virtual-row]')?.getAttribute('data-index') ?? '',
            10
          )
        }))
        .filter((row) => row.id.length > 0 && Number.isFinite(row.index))
        .sort((a, b) => a.index - b.index)
        .map((row) => row.id)
    )
}

async function waitForVisibleWorktreeOrder(page: Page, expectedIds: string[]): Promise<void> {
  await page.evaluate((expectedOrder) => {
    const sidebar = document.querySelector('[data-worktree-sidebar]')
    if (!sidebar) {
      throw new Error('Worktree sidebar is not available')
    }

    const hasExpectedOrder = (): boolean => {
      const actualOrder = Array.from(
        sidebar.querySelectorAll<HTMLElement>('[role="option"][data-worktree-id]')
      )
        .map((element) => ({
          id: element.dataset.worktreeId ?? '',
          index: Number.parseInt(
            element.closest('[data-worktree-virtual-row]')?.getAttribute('data-index') ?? '',
            10
          )
        }))
        .filter((row) => row.id.length > 0 && Number.isFinite(row.index))
        .sort((a, b) => a.index - b.index)
        .map((row) => row.id)
        .slice(0, expectedOrder.length)
      return (
        actualOrder.length === expectedOrder.length &&
        actualOrder.every((id, index) => id === expectedOrder[index])
      )
    }

    if (hasExpectedOrder()) {
      return
    }

    return new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (!hasExpectedOrder()) {
          return
        }
        observer.disconnect()
        resolve()
      })
      observer.observe(sidebar, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-index', 'data-worktree-id']
      })
    })
  }, expectedIds)
}

async function seedSmartSortScenario(page: Page): Promise<SmartSortScenario> {
  return page.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }

    const state = store.getState()
    state.setActiveView('terminal')
    state.setSidebarOpen(true)
    state.setGroupBy('none')
    state.setSortBy('recent')

    const worktrees = Object.values(state.worktreesByRepo)
      .flat()
      .filter((worktree) => !worktree.isArchived)
    if (worktrees.length < 2) {
      throw new Error('Smart sort E2E needs at least two worktrees')
    }

    const [blocked, done] = worktrees
    const now = Date.now()

    store.setState((current) => ({
      worktreesByRepo: Object.fromEntries(
        Object.entries(current.worktreesByRepo).map(([repoId, repoWorktrees]) => [
          repoId,
          repoWorktrees.map((worktree) => {
            if (worktree.id === blocked.id) {
              return {
                ...worktree,
                displayName: 'Z smart-sort blocked',
                lastActivityAt: now - 5 * 60_000,
                sortOrder: 0
              }
            }
            if (worktree.id === done.id) {
              return {
                ...worktree,
                displayName: 'A smart-sort done',
                lastActivityAt: now,
                sortOrder: 10
              }
            }
            return worktree
          })
        ])
      ),
      // Why: lineage fixes parent/child order and would mask the Smart comparator.
      worktreeLineageById: Object.fromEntries(
        Object.entries(current.worktreeLineageById).filter(
          ([worktreeId]) => worktreeId !== blocked.id && worktreeId !== done.id
        )
      )
    }))

    for (const worktree of [blocked, done]) {
      const currentState = store.getState()
      if ((currentState.tabsByWorktree[worktree.id] ?? []).length === 0) {
        currentState.createTab(worktree.id)
      }
    }

    const stateWithTabs = store.getState()
    const blockedTab = stateWithTabs.tabsByWorktree[blocked.id]?.[0]
    const doneTab = stateWithTabs.tabsByWorktree[done.id]?.[0]
    if (!blockedTab || !doneTab) {
      throw new Error('Smart sort E2E failed to create terminal tabs')
    }

    const blockedPtyId = stateWithTabs.ptyIdsByTabId[blockedTab.id]?.[0] ?? `e2e-${blockedTab.id}`
    const donePtyId = stateWithTabs.ptyIdsByTabId[doneTab.id]?.[0] ?? `e2e-${doneTab.id}`
    const firstLayoutLeafId = (node: TerminalPaneLayoutNode | null | undefined): string | null => {
      if (!node) {
        return null
      }
      return node.type === 'leaf'
        ? node.leafId
        : (firstLayoutLeafId(node.first) ?? firstLayoutLeafId(node.second))
    }
    let blockedLeafId = ''
    let doneLeafId = ''

    // Why: WorktreeList intentionally holds cold-start ordering until a live
    // PTY exists. E2E hidden windows can create tabs before panes mount, so
    // seed the live-PTY and stable-layout maps explicitly and let agent-status
    // writes drive the same sortEpoch path that hook events use in the app.
    store.setState((current) => {
      const blockedLayout = current.terminalLayoutsByTabId[blockedTab.id]
      const doneLayout = current.terminalLayoutsByTabId[doneTab.id]
      blockedLeafId = firstLayoutLeafId(blockedLayout?.root) ?? crypto.randomUUID()
      doneLeafId = firstLayoutLeafId(doneLayout?.root) ?? crypto.randomUUID()

      return {
        ptyIdsByTabId: {
          ...current.ptyIdsByTabId,
          [blockedTab.id]: current.ptyIdsByTabId[blockedTab.id]?.length
            ? current.ptyIdsByTabId[blockedTab.id]
            : [blockedPtyId],
          [doneTab.id]: current.ptyIdsByTabId[doneTab.id]?.length
            ? current.ptyIdsByTabId[doneTab.id]
            : [donePtyId]
        },
        terminalLayoutsByTabId: {
          ...current.terminalLayoutsByTabId,
          [blockedTab.id]: {
            root: blockedLayout?.root ?? { type: 'leaf', leafId: blockedLeafId },
            activeLeafId: blockedLayout?.activeLeafId ?? blockedLeafId,
            expandedLeafId: blockedLayout?.expandedLeafId ?? null,
            ptyIdsByLeafId: {
              ...blockedLayout?.ptyIdsByLeafId,
              [blockedLeafId]: blockedPtyId
            }
          },
          [doneTab.id]: {
            root: doneLayout?.root ?? { type: 'leaf', leafId: doneLeafId },
            activeLeafId: doneLayout?.activeLeafId ?? doneLeafId,
            expandedLeafId: doneLayout?.expandedLeafId ?? null,
            ptyIdsByLeafId: {
              ...doneLayout?.ptyIdsByLeafId,
              [doneLeafId]: donePtyId
            }
          }
        }
      }
    })

    return {
      blockedId: blocked.id,
      doneId: done.id,
      blockedTabId: blockedTab.id,
      doneTabId: doneTab.id,
      blockedPaneKey: `${blockedTab.id}:${blockedLeafId}`,
      donePaneKey: `${doneTab.id}:${doneLeafId}`
    }
  })
}

async function activateSmartSort(page: Page): Promise<void> {
  await page.evaluate(() => window.__store?.getState().setSortBy('smart'))
}

async function seedSmartSortAgentStatuses(page: Page, scenario: SmartSortScenario): Promise<void> {
  await page.evaluate((seededScenario) => {
    const actions = window.__store?.getState()
    if (!actions) {
      throw new Error('window.__store is not available')
    }

    const now = Date.now()
    actions.setAgentStatus(
      seededScenario.donePaneKey,
      { state: 'done', prompt: 'Finished', agentType: 'codex' },
      'codex',
      { updatedAt: now, stateStartedAt: now - 1_000 }
    )
    actions.setAgentStatus(
      seededScenario.blockedPaneKey,
      { state: 'blocked', prompt: 'Needs approval', agentType: 'codex' },
      'codex',
      { updatedAt: now, stateStartedAt: now - 60_000 }
    )
  }, scenario)
}

async function getSmartSortScenarioReadiness(
  page: Page,
  scenario: SmartSortScenario
): Promise<{
  blockedHasLivePty: boolean
  doneHasLivePty: boolean
  blockedState: string | null
  doneState: string | null
  fallbackOrder: string[]
}> {
  return page.evaluate((scenario) => {
    const state = window.__store?.getState()
    if (!state) {
      return {
        blockedHasLivePty: false,
        doneHasLivePty: false,
        blockedState: null,
        doneState: null,
        fallbackOrder: []
      }
    }
    const scenarioWorktrees = Object.values(state.worktreesByRepo)
      .flat()
      .filter((worktree) => worktree.id === scenario.blockedId || worktree.id === scenario.doneId)
    return {
      blockedHasLivePty: (state.ptyIdsByTabId[scenario.blockedTabId]?.length ?? 0) > 0,
      doneHasLivePty: (state.ptyIdsByTabId[scenario.doneTabId]?.length ?? 0) > 0,
      blockedState: state.agentStatusByPaneKey[scenario.blockedPaneKey]?.state ?? null,
      doneState: state.agentStatusByPaneKey[scenario.donePaneKey]?.state ?? null,
      fallbackOrder: scenarioWorktrees
        .sort((a, b) => b.sortOrder - a.sortOrder || a.displayName.localeCompare(b.displayName))
        .map((worktree) => worktree.id)
    }
  }, scenario)
}

test.describe('Worktree Smart Sort', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
  })

  test('renders attention-needed worktrees above finished agents in Smart mode', async ({
    orcaPage
  }) => {
    const scenario = await seedSmartSortScenario(orcaPage)
    const { blockedId, doneId } = scenario

    await waitForVisibleWorktreeOrder(orcaPage, [doneId, blockedId])
    await activateSmartSort(orcaPage)
    await seedSmartSortAgentStatuses(orcaPage, scenario)

    await expect
      .poll(() => getSmartSortScenarioReadiness(orcaPage, scenario), {
        timeout: 8_000,
        message: 'Smart sort scenario did not seed live PTYs and fresh agent statuses'
      })
      .toEqual({
        blockedHasLivePty: true,
        doneHasLivePty: true,
        blockedState: 'blocked',
        doneState: 'done',
        fallbackOrder: [doneId, blockedId]
      })

    await waitForVisibleWorktreeOrder(orcaPage, [blockedId, doneId])
    expect((await getVisibleWorktreeIdsByVirtualIndex(orcaPage)).slice(0, 2)).toEqual([
      blockedId,
      doneId
    ])

    await expect(worktreeRow(orcaPage, blockedId)).toBeVisible()
    await expect(worktreeRow(orcaPage, doneId)).toBeVisible()
  })
})
