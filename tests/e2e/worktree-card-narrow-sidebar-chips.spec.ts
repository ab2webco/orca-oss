/**
 * E2E regression for ORCA-160 and ORCA-161: the workspace card's title row held the Claude
 * account chip at `shrink-0`, so at the minimum sidebar width the row grew past
 * the list's `overflow-x-hidden` edge. The account email painted into the clip
 * and the trailing identifier chips were cut away entirely — which is how the
 * Plane chip from ORCA-160 read as "not rendering" on a linked card.
 *
 * happy-dom cannot catch this: it runs no layout, so only a real viewport can
 * tell "ellipsized in place" from "pushed past the visible edge".
 */

import { expect, test } from './helpers/orca-app'
import type { Locator, Page } from '@stablyai/playwright-test'
import { getActiveWorktreeId, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { worktreeRowSurface } from './worktree-row-locators'

// Why: MIN_SIDEBAR_WIDTH in the ui slice — the narrowest layout a user can drag to.
const NARROW_SIDEBAR_WIDTH = 220
// Why: the width ORCA-160 was reported at, where the identifier has to read in full.
const REPORTED_SIDEBAR_WIDTH = 490
const LONG_ACCOUNT_EMAIL = 'fabian.altahona@koombea-engineering.example.com'
const PLANE_IDENTIFIER = 'ORCA-161'

type SeedResult = { ok: true } | { ok: false; error: string }

async function seedLinkedCard(page: Page, worktreeId: string): Promise<SeedResult> {
  return page.evaluate(
    async ({ worktreeId, email, identifier }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      const accountId = 'e2e-claude-account'
      const now = Date.now()
      // Why: main rejects the whole updateMeta call when claudeAccountId names no
      // registered managed account, which drops linkedPlaneWorkItem with it.
      await store.getState().updateSettingsOrThrow({
        claudeManagedAccounts: [
          {
            id: accountId,
            email,
            managedAuthPath: `orca-e2e-managed-claude-account/${accountId}`,
            authMethod: 'oauth',
            createdAt: now,
            updatedAt: now,
            lastAuthenticatedAt: now
          }
        ]
      })
      store
        .getState()
        .setWorktreeCardProperties([
          'status',
          'unread',
          'issue',
          'linear-issue',
          'jira-issue',
          'plane-issue',
          'pr',
          'automation',
          'cli',
          'comment',
          'ports'
        ])
      store.getState().setClaudeAccountRoster({
        accounts: [
          {
            id: accountId,
            email,
            authMethod: 'oauth',
            createdAt: now,
            updatedAt: now,
            lastAuthenticatedAt: now
          }
        ],
        activeAccountId: accountId,
        activeAccountIdsByRuntime: { host: accountId, wsl: {} }
      })
      store.setState({
        planeWorkItemCache: {
          [`default::item::${identifier}`]: {
            data: {
              id: 'e2e-work-item',
              identifier,
              sequenceId: 161,
              title: 'Workspace card meta row overflows at narrow sidebar widths',
              url: `https://plane.example.com/ab2web/browse/${identifier}/`,
              project: { id: 'e2e-project', identifier: 'ORCA', name: 'Orca Lab' },
              state: { id: 'e2e-state', name: 'In Progress', group: 'started', color: '#F59E0B' },
              labels: [],
              updatedAt: new Date(now).toISOString(),
              createdAt: new Date(now).toISOString()
            },
            fetchedAt: now
          }
        }
      })
      return store.getState().updateWorktreeMeta(worktreeId, {
        claudeAccountId: accountId,
        linkedPlaneWorkItem: {
          identifier,
          projectId: 'e2e-project',
          url: `https://plane.example.com/ab2web/browse/${identifier}/`
        }
      })
    },
    { worktreeId, email: LONG_ACCOUNT_EMAIL, identifier: PLANE_IDENTIFIER }
  )
}

type ChipOverflow = { label: string; overflowPx: number }

/**
 * Everything in the card's title row that paints past the sidebar's visible edge.
 * The list clips with `overflow-x-hidden`, so anything beyond that edge is simply
 * gone from the user's screen — which is how the Plane chip read as "not rendering".
 *
 * Leaf nodes only: an ancestor that overflows always does so because of a leaf,
 * and reporting both just duplicates the same spill.
 */
async function titleRowContentOutsideSidebar(
  page: Page,
  worktreeId: string
): Promise<ChipOverflow[]> {
  return worktreeRowSurface(page, worktreeId).evaluate((surface) => {
    const row = surface.querySelector<HTMLElement>('[data-worktree-card-parent-content]')
    const clip = surface.closest<HTMLElement>('.worktree-sidebar-scrollbar')
    if (!row || !clip) {
      throw new Error('card title row or sidebar clip container not found')
    }
    const visibleRight = clip.getBoundingClientRect().right
    return [...row.querySelectorAll<HTMLElement>('*')]
      .filter((node) => node.childElementCount === 0)
      .map((node) => {
        const rect = node.getBoundingClientRect()
        return {
          label:
            node.closest('[aria-label]')?.getAttribute('aria-label') ??
            node.textContent?.trim() ??
            'content',
          // Why: sub-pixel layout rounding is not a spill; only report a real one.
          overflowPx: Math.round(rect.right - visibleRight),
          width: rect.width
        }
      })
      .filter((node) => node.width > 0 && node.overflowPx > 1)
      .map(({ label, overflowPx }) => ({ label, overflowPx }))
  })
}

/**
 * Hold the sidebar at a given width. Hydration re-applies the persisted width
 * after mount, so a single set can be undone — re-assert until it sticks.
 */
async function settleSidebarWidth(page: Page, width: number): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((target) => {
          window.__store?.getState().setSidebarWidth(target)
          return Math.round(
            document.querySelector('.worktree-sidebar-scrollbar')?.getBoundingClientRect().width ??
              0
          )
        }, width),
      { timeout: 15_000, intervals: [200, 200, 300, 500] }
    )
    .toBeLessThanOrEqual(width + 4)
}

function planeChipLocator(page: Page, worktreeId: string): Locator {
  return worktreeRowSurface(page, worktreeId)
    .locator('[data-worktree-card-identifier-chip="plane"]')
    .first()
}

test.describe('Workspace card chips across sidebar widths', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  test('keeps every title-row chip inside the visible sidebar instead of clipping it away', async ({
    orcaPage
  }) => {
    const worktreeId = (await getActiveWorktreeId(orcaPage))!
    expect(await seedLinkedCard(orcaPage, worktreeId)).toEqual({ ok: true })
    await settleSidebarWidth(orcaPage, NARROW_SIDEBAR_WIDTH)

    await expect(planeChipLocator(orcaPage, worktreeId)).toBeAttached({ timeout: 15_000 })

    await expect
      .poll(() => titleRowContentOutsideSidebar(orcaPage, worktreeId), { timeout: 10_000 })
      .toEqual([])
  })

  // Why ORCA-160: an ellipsized "ORCA…" identifies the work item no better than the
  // unlabelled glyph it replaced, so at the reported width it must read in full.
  test('reads the whole work item identifier at the reported sidebar width', async ({
    orcaPage
  }) => {
    const worktreeId = (await getActiveWorktreeId(orcaPage))!
    expect(await seedLinkedCard(orcaPage, worktreeId)).toEqual({ ok: true })
    await settleSidebarWidth(orcaPage, REPORTED_SIDEBAR_WIDTH)

    const planeChip = planeChipLocator(orcaPage, worktreeId)
    await expect(planeChip).toBeAttached({ timeout: 15_000 })

    await expect
      .poll(
        () =>
          planeChip.evaluate((chip) => ({
            text: chip.textContent?.trim() ?? '',
            // Why: the chip clips with overflow-hidden, so a wider scrollWidth is an ellipsis.
            ellipsized: chip.scrollWidth > chip.clientWidth + 1
          })),
        { timeout: 10_000 }
      )
      .toEqual({ text: PLANE_IDENTIFIER, ellipsized: false })
    expect(await titleRowContentOutsideSidebar(orcaPage, worktreeId)).toEqual([])
  })
})
