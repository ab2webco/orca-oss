/**
 * Invariant: a worktree name that is one long unbroken path (no spaces to wrap
 * on) still fits inside the Claude re-auth dialog — the row truncates instead
 * of pushing the "Live terminal" badge and the footer's Cancel button outside
 * the dialog (ORCA-533).
 * Needs E2E: Radix's ScrollArea wraps the viewport content in a shrink-to-fit
 * `display: table` div, so only a real layout engine shows a long row widening
 * the dialog; happy-dom has no layout at all.
 */

import type { Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'

const ACCOUNT_ID = 'orca-533-account'
/** One unbroken path long enough to outgrow a `sm:max-w-lg` dialog with nothing to wrap on. */
const LONG_WORKTREE_NAME =
  '/Users/fabolivar/Downloads/codecanyon-W3GXMzgS-doctorio-appointment-online-diagnostic-booking-management-multivendor-app-with-admin-panel/doctorio'

const CLAUDE_ACCOUNTS_STATE = {
  accounts: [
    {
      id: ACCOUNT_ID,
      email: 'orca-533@example.com',
      authMethod: 'subscription-oauth' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastAuthenticatedAt: Date.now()
    }
  ],
  activeAccountId: ACCOUNT_ID,
  activeAccountIdsByRuntime: { host: ACCOUNT_ID, wsl: {} }
}

const WORKTREE_USAGE_REPORT = {
  accountId: ACCOUNT_ID,
  worktrees: [
    { worktreeId: 'repo::orca-533', displayName: LONG_WORKTREE_NAME, hasLiveTerminal: true }
  ],
  liveTerminalCount: 1,
  pendingLaunchCount: 0,
  pendingGlobalLaunchCount: 0,
  blockedByOtherAccounts: [],
  supported: true
}

/** Drives the real setting so the whole window repaints, not just the root class. */
async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    window.__store?.setState({ settings })
  }, theme)
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

type DialogGeometry = {
  dialogRight: number
  windowWidth: number
  /** The Cancel button's right edge minus the dialog's content box: > 0 means
   *  the footer's Cancel button sticks out of the dialog. */
  cancelOverDialog: number
  /** The "Live terminal" badge's right edge minus the viewport's: > 0 means it
   *  was pushed off-screen by an unshrinkable row. */
  badgeOverViewport: number
  nameTruncated: boolean
  nameTitle: string | null
}

async function readDialogGeometry(page: Page): Promise<DialogGeometry | null> {
  return await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')
    const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    const cancelButton = Array.from(document.querySelectorAll<HTMLElement>('button')).find(
      (button) => button.textContent?.trim() === 'Cancel'
    )
    const badge = Array.from(document.querySelectorAll<HTMLElement>('span')).find(
      (span) => span.textContent?.trim() === 'Live terminal'
    )
    const nameEl = Array.from(document.querySelectorAll<HTMLElement>('span.truncate')).find(
      (span) => span.title?.includes('doctorio')
    )
    if (!dialog || !viewport || !cancelButton || !badge || !nameEl) {
      return null
    }
    const dialogRect = dialog.getBoundingClientRect()
    const dialogPaddingRight = Number.parseFloat(getComputedStyle(dialog).paddingRight)
    return {
      dialogRight: dialogRect.right,
      windowWidth: window.innerWidth,
      cancelOverDialog:
        cancelButton.getBoundingClientRect().right - (dialogRect.right - dialogPaddingRight),
      badgeOverViewport:
        badge.getBoundingClientRect().right - viewport.getBoundingClientRect().right,
      nameTruncated: nameEl.scrollWidth > nameEl.clientWidth + 1,
      nameTitle: nameEl.title || null
    }
  })
}

async function openReauthDialog(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('store unavailable')
    }
    state.openSettingsTarget({ pane: 'accounts', repoId: null })
    state.openSettingsPage()
  })
  const reauthButton = page.getByRole('button', { name: 'Re-authenticate' })
  await expect(reauthButton).toBeEnabled({ timeout: 15_000 })
  await reauthButton.click()

  await expect(page.getByRole('dialog', { name: /Close the live Claude terminals/ })).toBeVisible({
    timeout: 15_000
  })
  await expect(page.getByText(LONG_WORKTREE_NAME)).toBeVisible({ timeout: 15_000 })
  // The open animation scales the dialog from 95%: measuring mid-zoom reports a
  // layout nobody sees, and it changed the verdict between two runs.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const node = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')
        if (!node) {
          return 0
        }
        return Math.round(new DOMMatrixReadOnly(getComputedStyle(node).transform).a * 1000) / 1000
      })
    )
    .toBe(1)
}

test('keeps a long unbroken worktree name, its live badge and Cancel inside the re-auth dialog', async ({
  electronApp,
  orcaPage
}, testInfo: TestInfo) => {
  await electronApp.evaluate(
    ({ ipcMain }, { accounts, report }) => {
      ipcMain.removeHandler('claudeAccounts:list')
      ipcMain.handle('claudeAccounts:list', () => accounts)
      ipcMain.removeHandler('claudeAccounts:reauthenticate')
      ipcMain.handle('claudeAccounts:reauthenticate', () => {
        throw new Error('Claude account is in use by an assigned worktree.')
      })
      ipcMain.removeHandler('claudeAccounts:worktreeUsageReport')
      ipcMain.handle('claudeAccounts:worktreeUsageReport', () => report)
    },
    { accounts: CLAUDE_ACCOUNTS_STATE, report: WORKTREE_USAGE_REPORT }
  )

  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await setTheme(orcaPage, 'dark')
  await openReauthDialog(orcaPage)

  const geometry = await readDialogGeometry(orcaPage)
  expect(
    geometry,
    'the dialog, its badge, Cancel button or the row name never rendered'
  ).not.toBeNull()
  // Without this the row fits by accident — nothing long enough to truncate.
  expect(geometry!.nameTruncated, 'the name was not long enough to need truncating').toBe(true)
  expect(geometry!.nameTitle).toBe(LONG_WORKTREE_NAME)

  expect(geometry!.cancelOverDialog, JSON.stringify(geometry)).toBeLessThanOrEqual(1)
  expect(geometry!.badgeOverViewport, JSON.stringify(geometry)).toBeLessThanOrEqual(1)
  expect(
    geometry!.dialogRight - geometry!.windowWidth,
    JSON.stringify(geometry)
  ).toBeLessThanOrEqual(0)

  for (const width of [1440, 768, 390, 320]) {
    await orcaPage.setViewportSize({ width, height: 900 })
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(orcaPage, theme)
      const atWidth = await readDialogGeometry(orcaPage)
      expect(atWidth, `${width}px ${theme}: the dialog vanished`).not.toBeNull()
      expect(
        atWidth!.cancelOverDialog,
        `${width}px ${theme}: ${JSON.stringify(atWidth)}`
      ).toBeLessThanOrEqual(1)
      expect(
        atWidth!.badgeOverViewport,
        `${width}px ${theme}: ${JSON.stringify(atWidth)}`
      ).toBeLessThanOrEqual(1)
      expect(
        atWidth!.dialogRight - atWidth!.windowWidth,
        `${width}px ${theme}: dialog wider than the window`
      ).toBeLessThanOrEqual(0)
      await orcaPage.screenshot({
        path: testInfo.outputPath(`reauth-dialog-${width}-${theme}.png`)
      })
    }
  }
})
