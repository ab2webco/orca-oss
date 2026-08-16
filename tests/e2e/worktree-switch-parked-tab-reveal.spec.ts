import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

// Shrinks the 5-minute hot-retain window so a tab parks inside a test run.
const PARKING_DELAY_MS = Number(process.env.ORCA_E2E_TERMINAL_PARKING_DELAY_MS) || 500

test.use({
  orcaAppExtraEnv: { ORCA_E2E_TERMINAL_PARKING_DELAY_MS: String(PARKING_DELAY_MS) }
})

// Anything near the 1s stranding backstop means the timer, not readiness, decided the switch.
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

    // Two visible groups: both group-active tabs gate the reveal, only one is park-exempt.
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

    await orcaPage.evaluate((worktreeId) => {
      window.__store?.getState().setActiveWorktree(worktreeId)
    }, firstWorktreeId)

    // Precondition, not assumption: a group-active tab really did unmount while hidden.
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

    const reveal = await orcaPage.evaluate(
      async ({ secondId, parkedTabId }) => {
        const root = document.querySelector<HTMLElement>('[data-rendered-active-worktree-id]')
        const targetSurface = [...document.querySelectorAll<HTMLElement>('[data-worktree-id]')]
          .find((candidate) => candidate.dataset.worktreeId === secondId)
          ?.querySelector<HTMLElement>('[data-worktree-card-surface]')
        if (!root || !targetSurface) {
          throw new Error('Missing rendered worktree root or target surface')
        }
        // Delivery batch, not DOM order: a backstop reveal remounts the parked tab in its own
        // commit, so both land in one batch. Readiness needs the mount to have happened earlier.
        let batchIndex = 0
        let mutationIndex = 0
        let parkedTabMountIndex: number | null = null
        let parkedTabMountBatch: number | null = null
        let revealIndex: number | null = null
        let revealBatch: number | null = null
        const clickAtMs = performance.now()
        const revealed = new Promise<number | null>((resolve) => {
          const timeoutId = window.setTimeout(() => {
            observer.disconnect()
            resolve(null)
          }, 5000)
          const observer = new MutationObserver((records) => {
            batchIndex += 1
            for (const record of records) {
              mutationIndex += 1
              if (
                parkedTabMountIndex === null &&
                record.type === 'childList' &&
                [...record.addedNodes].some(
                  (node) =>
                    node instanceof HTMLElement &&
                    (node.matches(`[data-terminal-tab-id="${parkedTabId}"]`) ||
                      node.querySelector(`[data-terminal-tab-id="${parkedTabId}"]`) !== null)
                )
              ) {
                parkedTabMountIndex = mutationIndex
                parkedTabMountBatch = batchIndex
              }
              if (
                revealIndex === null &&
                record.type === 'attributes' &&
                root.getAttribute('data-rendered-active-worktree-id') === secondId
              ) {
                revealIndex = mutationIndex
                revealBatch = batchIndex
              }
            }
            if (revealIndex === null) {
              return
            }
            window.clearTimeout(timeoutId)
            observer.disconnect()
            resolve(performance.now() - clickAtMs)
          })
          observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-rendered-active-worktree-id'],
            childList: true,
            subtree: true
          })
        })
        targetSurface.click()
        const revealMs = await revealed
        return {
          revealMs,
          parkedTabMountIndex,
          parkedTabMountBatch,
          revealIndex,
          revealBatch,
          activeWorktreeId: window.__store?.getState().activeWorktreeId ?? null,
          renderedWorktreeId: root.getAttribute('data-rendered-active-worktree-id')
        }
      },
      { secondId: secondWorktreeId, parkedTabId: parkedTabIds[0] }
    )

    console.info(
      '[ORCA-229 parked-tab reveal]',
      JSON.stringify({
        revealMs: reveal.revealMs,
        activeWorktreeId: reveal.activeWorktreeId,
        renderedWorktreeId: reveal.renderedWorktreeId,
        parkedTabMountBatch: reveal.parkedTabMountBatch,
        revealBatch: reveal.revealBatch,
        parkedTabIds,
        expectedWorktreeId: secondWorktreeId,
        outgoingWorktreeId: firstWorktreeId
      })
    )
    await testInfo.attach('parked-tab-reveal', {
      body: JSON.stringify({ ...reveal, parkedTabIds, splitTabIds }, null, 2),
      contentType: 'application/json'
    })

    // The parked tab remounted in an earlier commit than the reveal: readiness released it.
    expect(reveal.parkedTabMountBatch).not.toBeNull()
    expect(reveal.parkedTabMountBatch ?? Number.POSITIVE_INFINITY).toBeLessThan(
      reveal.revealBatch ?? 0
    )
    expect(reveal.activeWorktreeId).toBe(secondWorktreeId)
    expect(reveal.renderedWorktreeId).toBe(secondWorktreeId)
    expect(reveal.revealMs).not.toBeNull()
    expect(reveal.revealMs ?? Number.POSITIVE_INFINITY).toBeLessThan(MAX_PARKED_TAB_REVEAL_MS)
  })
})
