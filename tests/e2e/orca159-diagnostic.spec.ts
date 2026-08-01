import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const MARQUEE_WORKSPACE_COUNT = 102

type Orca159Window = { __orca159: string[] }

test.describe('ORCA-159 diagnostic', () => {
  test('marquee anchor diagnosis', async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)

    const statusId = 'virtual-marquee'
    await orcaPage.evaluate(
      ({ count, status }) => {
        const store = window.__store
        if (!store) {
          throw new Error('window.__store is not available')
        }
        const state = store.getState()
        const repo = state.repos[0]
        if (!repo) {
          throw new Error('Expected a seeded e2e repo')
        }
        const now = Date.now()
        const seeded = state.worktreesByRepo[repo.id] ?? []
        const synthetic = Array.from({ length: count }, (_, index) => ({
          id: `${repo.id}::/virtual-marquee-${index}`,
          instanceId: `virtual-marquee-${index}`,
          repoId: repo.id,
          path: `${repo.path}/../virtual-marquee-${index}`,
          displayName: `Virtual marquee ${index}`,
          comment: '',
          linkedIssue: null,
          linkedPR: null,
          linkedLinearIssue: null,
          isArchived: false,
          isUnread: false,
          isPinned: false,
          sortOrder: 10_000 - index,
          manualOrder: 10_000 - index,
          lastActivityAt: now - index - 100,
          head: '0000000000000000000000000000000000000000',
          branch: `virtual-marquee-${index}`,
          isBare: false,
          isMainWorktree: false,
          workspaceStatus: status
        }))

        state.setSidebarOpen(true)
        state.setShowSleepingWorkspaces(true)
        state.setFilterRepoIds([])
        store.setState({
          sortBy: 'manual',
          worktreesByRepo: {
            ...state.worktreesByRepo,
            [repo.id]: [...seeded, ...synthetic]
          }
        })
        state.setWorkspaceStatuses([
          { id: status, label: 'Virtual marquee' },
          ...state.workspaceStatuses.filter((entry) => entry.id !== status)
        ])
      },
      { count: MARQUEE_WORKSPACE_COUNT, status: statusId }
    )

    await orcaPage.getByRole('button', { name: 'Workspace board' }).click()

    const lane = orcaPage.locator(`[data-workspace-status="${statusId}"]`)
    await expect(lane.getByText(String(MARQUEE_WORKSPACE_COUNT), { exact: true })).toBeVisible()
    const laneCards = lane.locator('[data-workspace-board-card-id]')
    await expect.poll(() => laneCards.count(), { timeout: 15_000 }).toBeGreaterThan(3)
    const laneScroll = lane.locator('[data-workspace-board-lane-scroll]')
    const selectionSurface = orcaPage.locator('[data-workspace-board-selection-surface]')
    const box = await laneScroll.boundingBox()
    const selectionBox = await selectionSurface.boundingBox()
    if (!box || !selectionBox) {
      throw new Error('Expected boxes')
    }
    const anchorX = selectionBox.x + 4
    const anchorY = box.y + 12
    const endX = box.x + box.width - 18
    const endY = box.y + 80

    const probe = await orcaPage.evaluate(
      ({ ax, ay }) => {
        const describe = (element: Element | null): string => {
          if (!element) {
            return 'null'
          }
          const attrs = Array.from(element.attributes)
            .map((attribute) => `${attribute.name}="${attribute.value.slice(0, 48)}"`)
            .join(' ')
          return `<${element.tagName.toLowerCase()} ${attrs}>`
        }
        const log = ((window as unknown as Orca159Window).__orca159 = [] as string[])
        const surface = document.querySelector('[data-workspace-board-selection-surface]')
        // Why: bubble phase on window runs after React's root handler, so
        // defaultPrevented reports whether the marquee actually engaged.
        window.addEventListener('pointerdown', (event) => {
          log.push(
            `pointerdown target=${describe(event.target as Element)} defaultPrevented=${event.defaultPrevented} inSurface=${Boolean(surface?.contains(event.target as Node))} elementFromPoint=${describe(document.elementFromPoint(event.clientX, event.clientY))} button=${event.button} pointerType=${event.pointerType}`
          )
        })
        window.addEventListener('mousedown', (event) => {
          log.push(`mousedown target=${describe(event.target as Element)}`)
        })
        const anchor = document.elementFromPoint(ax, ay)
        const chain: string[] = []
        let node = anchor
        while (node && chain.length < 6) {
          chain.push(describe(node))
          node = node.parentElement
        }
        return {
          anchor: describe(anchor),
          anchorInSurface: Boolean(anchor && surface?.contains(anchor)),
          anchorChain: chain,
          cardCount: document.querySelectorAll('[data-workspace-board-card-id]').length,
          surfaceRect: surface?.getBoundingClientRect().toJSON(),
          devicePixelRatio: window.devicePixelRatio,
          viewport: { w: window.innerWidth, h: window.innerHeight }
        }
      },
      { ax: anchorX, ay: anchorY }
    )

    console.log('[ORCA159] laneScrollBox=', JSON.stringify(box))
    console.log('[ORCA159] selectionBox=', JSON.stringify(selectionBox))
    console.log('[ORCA159] anchor=', anchorX, anchorY, 'end=', endX, endY)
    console.log('[ORCA159] probe=', JSON.stringify(probe, null, 2))

    await orcaPage.mouse.move(anchorX, anchorY)
    await orcaPage.mouse.down()
    console.log(
      '[ORCA159] events=',
      JSON.stringify(await orcaPage.evaluate(() => (window as unknown as Orca159Window).__orca159))
    )

    await orcaPage.mouse.move(endX, endY, { steps: 4 })

    const after = await orcaPage.evaluate(() => ({
      selected: document.querySelectorAll('[data-workspace-board-card-area-selected="true"]')
        .length,
      overlayHidden: document
        .querySelector('[data-workspace-board-selection-rect]')
        ?.classList.contains('hidden'),
      overlayStyle: document
        .querySelector<HTMLElement>('[data-workspace-board-selection-rect]')
        ?.getAttribute('style'),
      selection: String(document.getSelection()).slice(0, 160),
      cardCount: document.querySelectorAll('[data-workspace-board-card-id]').length,
      laneScrollRect: document
        .querySelector(
          '[data-workspace-status="virtual-marquee"] [data-workspace-board-lane-scroll]'
        )
        ?.getBoundingClientRect()
        .toJSON(),
      surfaceRect: document
        .querySelector('[data-workspace-board-selection-surface]')
        ?.getBoundingClientRect()
        .toJSON()
    }))
    console.log('[ORCA159] afterDrag=', JSON.stringify(after, null, 2))
    await orcaPage.mouse.up()
  })
})
