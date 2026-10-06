/**
 * Invariant: the automation editor offers the managed Claude/Codex account of the selected
 * agent, a picked account is saved on the automation, editing re-hydrates it, and clearing it
 * back to inherit persists null (ORCA-553).
 * Needs E2E: the field must sit in the Agent row and stay readable down to 320px, and the save
 * crosses the real renderer -> IPC -> persistence path.
 */

import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

const WIDTHS = [1440, 768, 390, 320]
const INHERIT_LABEL = 'Inherit (worktree or global)'

function summary(id: string, email: string): Record<string, unknown> {
  const now = Date.now()
  return {
    id,
    email,
    authMethod: 'subscription-oauth',
    createdAt: now,
    updatedAt: now,
    lastAuthenticatedAt: now
  }
}

const CLAUDE_STATE = {
  accounts: [
    summary('claude-alice', 'alice@example.com'),
    summary('claude-bob', 'bob@example.com')
  ],
  activeAccountId: 'claude-alice',
  activeAccountIdsByRuntime: { host: 'claude-alice', wsl: {} }
}
const CODEX_STATE = {
  accounts: [summary('codex-carol', 'carol@example.com')],
  activeAccountId: 'codex-carol'
}

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

/** The main window floors at 600px, so phone widths need the floor lifted first. */
async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
}

async function savedAutomations(
  page: Page
): Promise<{ name: string; claudeAccountId?: string | null }[]> {
  return page.evaluate(async () => {
    const list = await window.api.automations.list()
    return list.map((entry) => ({ name: entry.name, claudeAccountId: entry.claudeAccountId }))
  })
}

async function pickClaudeAccount(page: Page, option: string): Promise<void> {
  await page.getByRole('combobox', { name: 'Claude account' }).click()
  await page.getByRole('option', { name: option }).click()
}

test('saves, re-hydrates and clears the Claude account pinned on an automation', async ({
  electronApp,
  orcaPage
}, testInfo: TestInfo) => {
  await waitForSessionReady(orcaPage)
  await electronApp.evaluate(
    ({ ipcMain }, { claude, codex }) => {
      ipcMain.removeHandler('claudeAccounts:list')
      ipcMain.handle('claudeAccounts:list', () => claude)
      ipcMain.removeHandler('codexAccounts:list')
      ipcMain.handle('codexAccounts:list', () => codex)
    },
    { claude: CLAUDE_STATE, codex: CODEX_STATE }
  )
  await orcaPage.evaluate(async () => {
    const settings = await window.api.settings.set({ defaultTuiAgent: 'claude' })
    window.__store?.setState({ settings })
    window.__store?.getState().openAutomationsPage()
  })

  await setWindowWidth(electronApp, orcaPage, 1440)
  await setTheme(orcaPage, 'light')
  await orcaPage.getByRole('button', { name: 'Add new' }).click()
  await orcaPage.getByRole('textbox', { name: 'Automation name' }).fill('Account pin e2e')
  await orcaPage
    .getByPlaceholder('Run the weekly dependency audit and summarize risky changes.')
    .fill('Summarize the repo')

  const picker = orcaPage.getByRole('combobox', { name: 'Claude account' })
  await expect(picker).toBeVisible()
  await expect(picker).toHaveText(INHERIT_LABEL)
  await expect(orcaPage.getByRole('combobox', { name: 'Codex account' })).toHaveCount(0)

  await pickClaudeAccount(orcaPage, 'bob@example.com')
  await expect(picker).toHaveText('bob@example.com')

  for (const width of WIDTHS) {
    await setWindowWidth(electronApp, orcaPage, width)
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(orcaPage, theme)
      await orcaPage.screenshot({
        path: testInfo.outputPath(`editor-closed-${width}-${theme}.png`)
      })
      await picker.click()
      await expect(orcaPage.getByRole('option', { name: 'alice@example.com' })).toBeVisible()
      // The popup fades in; a capture mid-animation shows an empty dialog.
      await expect
        .poll(async () =>
          orcaPage.evaluate(
            () =>
              document
                .querySelector('[data-slot="select-content"]')
                ?.getAnimations({ subtree: true }).length
          )
        )
        .toBe(0)
      await orcaPage.screenshot({ path: testInfo.outputPath(`editor-open-${width}-${theme}.png`) })
      await orcaPage.keyboard.press('Escape')
      await expect(orcaPage.getByRole('listbox')).toHaveCount(0)
    }
  }

  await setWindowWidth(electronApp, orcaPage, 1440)
  await orcaPage.getByRole('button', { name: 'Create' }).click()
  await expect
    .poll(async () => savedAutomations(orcaPage))
    .toEqual([{ name: 'Account pin e2e', claudeAccountId: 'claude-bob' }])

  await orcaPage.getByText('Account pin e2e', { exact: true }).click()
  await orcaPage.getByRole('button', { name: 'Edit automation' }).click()
  await expect(orcaPage.getByRole('combobox', { name: 'Claude account' })).toHaveText(
    'bob@example.com'
  )
  await pickClaudeAccount(orcaPage, INHERIT_LABEL)
  await orcaPage.getByRole('button', { name: 'Save Changes' }).click()
  await expect
    .poll(async () => savedAutomations(orcaPage))
    .toEqual([{ name: 'Account pin e2e', claudeAccountId: null }])
})
