import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

// Why (ORCA-229): the pre-mount reveal gate holds the outgoing worktree until every
// group-active terminal of the incoming one reports its mount. Per-tab cold parking
// unmounts exactly those tabs while the worktree is hidden, and its own visibility
// input is the same flag the gate is withholding — so a parked tab can never report,
// and the switch resolves on the stranding backstop instead of on readiness.
// The 5-minute hot-retain window is shrunk here the way every other parking spec
// shrinks it; the wiring under test is identical.
const PARKING_DELAY_MS = Number(process.env.ORCA_E2E_TERMINAL_PARKING_DELAY_MS) || 500

test.use({
  orcaAppExtraEnv: { ORCA_E2E_TERMINAL_PARKING_DELAY_MS: String(PARKING_DELAY_MS) }
})

// Why: readiness-driven reveal is one render past the pane mount. Anything near the
// 1s stranding backstop means the gate never resolved and the timer decided the switch.
const MAX_PARKED_TAB_REVEAL_MS = 400

test.describe('Worktree switch with a cold-parked split tab', () => {
  test('reveals the incoming worktree on readiness, not on the stranding backstop', async ({
    orcaPage
  }, testInfo) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)

    const [firstWorktreeId, secondWorktreeId] = await orcaPage.evaluate(async () => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      const state = store.getState()
      state.setActiveView('terminal')
      state.setSidebarOpen(true)
      state.setGroupBy('none')
      state.setSortBy('recent')
      state.setShowActiveOnly(false)
      state.setShowSleepingWorkspaces(true)
      state.setHideDefaultBranchWorkspace(false)
      state.setFilterRepoIds([])

      const repo = state.repos[0]
      const worktrees = repo ? (state.worktreesByRepo[repo.id] ?? []) : []
      if (worktrees.length < 2) {
        throw new Error('This spec needs at least two worktrees')
      }
      const [first, second] = worktrees
      state.revealWorktreeInSidebar(first.id, { behavior: 'auto' })
      state.revealWorktreeInSidebar(second.id, { behavior: 'auto' })
      state.setActiveWorktree(second.id)
      return [first.id, second.id]
    })

    // Split the incoming worktree so two groups are visible at once: both group-active
    // tabs are required by the reveal gate, and only the most recently hidden one is
    // exempt from cold parking.
    const splitTabIds = await orcaPage.evaluate(async (worktreeId) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      const state = store.getState()
      state.ensureWorktreeRootGroup(worktreeId)
      const rootGroupId =
        store.getState().activeGroupIdByWorktree[worktreeId] ??
        store.getState().groupsByWorktree[worktreeId]?.[0]?.id
      if (!rootGroupId) {
        throw new Error('No root group for the split-group setup')
      }
      const existingTabs = store.getState().tabsByWorktree[worktreeId] ?? []
      const rootTabId =
        existingTabs[0]?.id ??
        store.getState().createTab(worktreeId, rootGroupId, undefined, { activate: true }).id
      const splitGroupId = store.getState().createEmptySplitGroup(worktreeId, rootGroupId, 'right')
      if (!splitGroupId) {
        throw new Error('Failed to create the split group')
      }
      const splitTab = store
        .getState()
        .createTab(worktreeId, splitGroupId, undefined, { activate: true })
      store.getState().focusGroup(worktreeId, splitGroupId)
      store.getState().setActiveTab(splitTab.id)
      store.getState().setActiveTabType('terminal')
      return { rootTabId, splitTabId: splitTab.id, rootGroupId, splitGroupId }
    }, secondWorktreeId)

    const incomingXterms = orcaPage.locator(
      `[data-terminal-worktree-id="${secondWorktreeId}"] .xterm`
    )
    await expect(incomingXterms).toHaveCount(2, { timeout: 30_000 })

    // Hide the worktree and let per-tab cold parking run past its shrunk hot-retain window.
    await orcaPage.evaluate((worktreeId) => {
      window.__store?.getState().setActiveWorktree(worktreeId)
    }, firstWorktreeId)

    // Precondition, asserted rather than assumed: a group-active tab of the incoming
    // worktree really did get unmounted while hidden. Without it the repro proves nothing.
    await expect(incomingXterms).toHaveCount(1, { timeout: PARKING_DELAY_MS * 20 })
    const parkedTabIds = await orcaPage.evaluate(
      ({ worktreeId, tabIds }) => {
        const mountedTabIds = new Set(
          [
            ...document.querySelectorAll<HTMLElement>(
              `[data-terminal-worktree-id="${worktreeId}"] [data-terminal-tab-id]`
            )
          ].map((element) => element.dataset.terminalTabId ?? '')
        )
        return tabIds.filter((tabId) => !mountedTabIds.has(tabId))
      },
      { worktreeId: secondWorktreeId, tabIds: [splitTabIds.rootTabId, splitTabIds.splitTabId] }
    )
    expect(parkedTabIds.length).toBeGreaterThan(0)

    const reveal = await orcaPage.evaluate(async (secondId) => {
      const root = document.querySelector<HTMLElement>('[data-rendered-active-worktree-id]')
      const targetSurface = [...document.querySelectorAll<HTMLElement>('[data-worktree-id]')]
        .find((candidate) => candidate.dataset.worktreeId === secondId)
        ?.querySelector<HTMLElement>('[data-worktree-card-surface]')
      if (!root || !targetSurface) {
        throw new Error('Missing rendered worktree root or target surface')
      }
      const clickAtMs = performance.now()
      const revealed = new Promise<number | null>((resolve) => {
        const timeoutId = window.setTimeout(() => {
          observer.disconnect()
          resolve(null)
        }, 5000)
        const observer = new MutationObserver(() => {
          if (root.getAttribute('data-rendered-active-worktree-id') !== secondId) {
            return
          }
          window.clearTimeout(timeoutId)
          observer.disconnect()
          resolve(performance.now() - clickAtMs)
        })
        observer.observe(root, {
          attributes: true,
          attributeFilter: ['data-rendered-active-worktree-id']
        })
      })
      targetSurface.click()
      const revealMs = await revealed
      return {
        revealMs,
        activeWorktreeId: window.__store?.getState().activeWorktreeId ?? null,
        renderedWorktreeId: root.getAttribute('data-rendered-active-worktree-id')
      }
    }, secondWorktreeId)

    console.info('[ORCA-229 parked-tab reveal]', JSON.stringify({ ...reveal, parkedTabIds }))
    await testInfo.attach('parked-tab-reveal', {
      body: JSON.stringify({ ...reveal, parkedTabIds, splitTabIds }, null, 2),
      contentType: 'application/json'
    })

    // The switch must land on the worktree the user clicked, never bounce back.
    expect(reveal.activeWorktreeId).toBe(secondWorktreeId)
    expect(reveal.renderedWorktreeId).toBe(secondWorktreeId)
    expect(reveal.revealMs).not.toBeNull()
    expect(reveal.revealMs ?? Number.POSITIVE_INFINITY).toBeLessThan(MAX_PARKED_TAB_REVEAL_MS)
  })
})
