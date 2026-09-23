/**
 * Invariant: every row of "Choose what to sync" fits inside the dialog's scroll
 * viewport, and the list keeps its scroll offset when the Accounts pane behind it
 * re-renders (ORCA-525).
 * Needs E2E: Radix wraps the viewport content in a shrink-to-fit `display: table`
 * div, so only a real layout engine shows a long row outgrowing the viewport, and
 * only a real pane re-render shows the list surviving one.
 */

import type { Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'

/** Names long enough that a shrink-to-fit wrapper outgrows a 512px dialog. */
const INVENTORY = {
  mcpServers: [
    'mcp__claude_ai_Google_Drive__download_file_content',
    'mcp__claude_ai_Google_Drive__get_file_permissions',
    'mcp__plugin_slack_slack__complete_authentication',
    'mcp__plane__create_work_item_property_option',
    'mcp__lune__lune_update_optimizer_settings',
    'mcp__engram__mem_suggest_topic_key',
    'mcp__graft__graft_check_freshness',
    'context7',
    'playwright'
  ].map((name) => ({ name, source: 'user-config' as const })),
  skills: [
    'cowork-plugin-management:cowork-plugin-customizer',
    'anthropic-skills:canvas-3d-particle-field',
    'anthropic-skills:using-n8n-mcp-skills',
    'orca-per-workspace-env',
    'judgment-day',
    'chained-pr',
    'archify',
    'graft'
  ],
  hooks: [
    {
      id: 'gentle-ai:PreToolUse:0',
      pluginName: 'gentle-ai',
      event: 'PreToolUse',
      matcher: 'Bash',
      command: '/Users/someone/.claude/plugins/gentle-ai/hooks/coordinator-positional-guard.sh'
    },
    {
      id: 'gentle-ai:PostToolUse:0',
      pluginName: 'gentle-ai',
      event: 'PostToolUse',
      matcher: 'Edit|Write',
      command: '/Users/someone/.claude/plugins/gentle-ai/hooks/renderer-brand-drift-ratchet.sh'
    },
    {
      id: 'engram:SessionStart:0',
      pluginName: 'engram',
      event: 'SessionStart',
      matcher: null,
      command: '/Users/someone/.claude/plugins/engram/hooks/session-start-project-detect.mjs'
    }
  ]
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

type ListGeometry = {
  rowCount: number
  viewportWidth: number
  /** Widest row's right edge minus the viewport's: > 0 means rows are clipped. */
  rowOverViewport: number
  /** The scroll area's right edge minus the dialog's content box: > 0 means the
   *  list sticks out of the dialog. */
  listOverDialog: number
  verticalOverflow: number
  truncatedLabels: number
  dialogOverWindow: number
}

async function readListGeometry(page: Page): Promise<ListGeometry | null> {
  return await page.evaluate(() => {
    const view = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    const root = document.querySelector<HTMLElement>('[data-slot="scroll-area"]')
    const dialog = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')
    if (!view || !root || !dialog) {
      return null
    }
    const viewRect = view.getBoundingClientRect()
    const dialogRect = dialog.getBoundingClientRect()
    const dialogPaddingRight = Number.parseFloat(getComputedStyle(dialog).paddingRight)
    const rows = [...view.querySelectorAll<HTMLElement>('label')]
    const labels = rows
      .map((row) => row.querySelector<HTMLElement>('span.truncate'))
      .filter((node): node is HTMLElement => node !== null)
    return {
      rowCount: rows.length,
      viewportWidth: viewRect.width,
      rowOverViewport: rows.reduce(
        (worst, row) => Math.max(worst, row.getBoundingClientRect().right - viewRect.right),
        Number.NEGATIVE_INFINITY
      ),
      listOverDialog: root.getBoundingClientRect().right - (dialogRect.right - dialogPaddingRight),
      verticalOverflow: view.scrollHeight - view.clientHeight,
      truncatedLabels: labels.filter((node) => node.scrollWidth > node.clientWidth + 1).length,
      dialogOverWindow: dialogRect.right - window.innerWidth
    }
  })
}

/** The list's current offset; -1 when the list is gone, which is the defect. */
async function listScrollTop(page: Page): Promise<number> {
  return await page.evaluate(
    () => document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')?.scrollTop ?? -1
  )
}

async function openSyncDialog(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('store unavailable')
    }
    state.openSettingsTarget({ pane: 'accounts', repoId: null })
    state.openSettingsPage()
  })
  const trigger = page.getByRole('button', { name: 'Sync global config' })
  await expect(trigger).toBeEnabled({ timeout: 15_000 })
  await trigger.click()
  await expect(page.getByRole('dialog', { name: 'Choose what to sync' })).toBeVisible({
    timeout: 15_000
  })
  await expect(page.getByText('mcp__graft__graft_check_freshness')).toBeVisible({ timeout: 15_000 })
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

test('fits every sync row inside the dialog and keeps its scroll across a pane re-render', async ({
  electronApp,
  orcaPage
}, testInfo: TestInfo) => {
  await electronApp.evaluate(({ ipcMain }, inventory) => {
    ipcMain.removeHandler('claudeAccounts:previewGlobalConfig')
    ipcMain.handle('claudeAccounts:previewGlobalConfig', async () => inventory)
  }, INVENTORY)

  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await setTheme(orcaPage, 'dark')
  await openSyncDialog(orcaPage)

  const geometry = await readListGeometry(orcaPage)
  expect(geometry, 'the dialog list never rendered').not.toBeNull()
  // Without these two the list fits by accident and every assertion below passes
  // against the bug: nothing to scroll, nothing long enough to overflow.
  expect(
    geometry!.verticalOverflow,
    'the list does not scroll — the check proves nothing'
  ).toBeGreaterThan(0)
  expect(
    geometry!.truncatedLabels,
    'no label was long enough to need truncating — the check proves nothing'
  ).toBeGreaterThan(0)

  expect(geometry!.rowOverViewport, JSON.stringify(geometry)).toBeLessThanOrEqual(1)
  expect(geometry!.listOverDialog, JSON.stringify(geometry)).toBeLessThanOrEqual(1)
  expect(geometry!.dialogOverWindow, JSON.stringify(geometry)).toBeLessThanOrEqual(0)

  // The offset has to survive a real Accounts pane re-render, which is when the
  // flicker showed up — a still dialog proves nothing.
  const offset = await orcaPage.evaluate(() => {
    const view = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!
    view.scrollTop = view.scrollHeight
    return view.scrollTop
  })
  expect(offset, 'could not scroll the list').toBeGreaterThan(0)

  for (const blur of [false, true, false]) {
    await orcaPage.evaluate(async (next) => {
      // An unrelated setting write: the same store churn the quota poll causes.
      const settings = await window.api.settings.set({ windowBackgroundBlur: next })
      window.__store?.setState({ settings })
    }, blur)
  }
  await expect(listScrollTop(orcaPage), 'the pane re-render reset the list').resolves.toBe(offset)
  await expect(orcaPage.getByText('mcp__graft__graft_check_freshness')).toBeVisible()

  for (const width of [1440, 768, 390, 320]) {
    await orcaPage.setViewportSize({ width, height: 900 })
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(orcaPage, theme)
      const atWidth = await readListGeometry(orcaPage)
      expect(atWidth, `${width}px ${theme}: the dialog list vanished`).not.toBeNull()
      expect(
        atWidth!.rowOverViewport,
        `${width}px ${theme}: ${JSON.stringify(atWidth)}`
      ).toBeLessThanOrEqual(1)
      expect(
        atWidth!.listOverDialog,
        `${width}px ${theme}: ${JSON.stringify(atWidth)}`
      ).toBeLessThanOrEqual(1)
      expect(
        atWidth!.dialogOverWindow,
        `${width}px ${theme}: dialog wider than the window`
      ).toBeLessThanOrEqual(0)
      await orcaPage.screenshot({ path: testInfo.outputPath(`sync-dialog-${width}-${theme}.png`) })
    }
  }
})
