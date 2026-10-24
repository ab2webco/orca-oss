import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

// Source frames for the README accounts GIF. The roster is invented demo data
// on example.com, served by replacing the main-process handlers for this run.
const WINDOW_WIDTH = 1280
const WINDOW_HEIGHT = 800
const HOLD_MS = 900

const now = Date.now()
const account = (id: string, email: string) => ({
  id,
  email,
  authMethod: 'subscription-oauth' as const,
  createdAt: now,
  updatedAt: now,
  lastAuthenticatedAt: now
})
const ROSTER = {
  accounts: [
    account('demo-work', 'work@example.com'),
    account('demo-team', 'team@example.com'),
    account('demo-oss', 'oss@example.com')
  ],
  activeAccountId: 'demo-work',
  activeAccountIdsByRuntime: { host: 'demo-work', wsl: {} as Record<string, string> }
}

test('switches the active Claude account from the accounts pane', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await electronApp.evaluate(
    ({ BrowserWindow, ipcMain }, { size, roster }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height)
      let state = roster
      ipcMain.removeHandler('claudeAccounts:list')
      ipcMain.handle('claudeAccounts:list', () => state)
      ipcMain.removeHandler('claudeAccounts:select')
      ipcMain.handle('claudeAccounts:select', (_event, args: { accountId: string | null }) => {
        const active = args.accountId ?? ''
        state = {
          ...state,
          activeAccountId: active,
          activeAccountIdsByRuntime: { ...state.activeAccountIdsByRuntime, host: active }
        }
        return state
      })
      // No usage lookups for invented accounts.
      ipcMain.removeHandler('rateLimits:fetchInactiveClaudeAccounts')
      ipcMain.handle('rateLimits:fetchInactiveClaudeAccounts', async () => undefined)
    },
    { size: { width: WINDOW_WIDTH, height: WINDOW_HEIGHT }, roster: ROSTER }
  )
  await orcaPage.evaluate(async () => {
    const settings = await window.api.settings.set({ theme: 'dark' })
    const state = window.__store!.getState()
    window.__store!.setState({ settings })
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'accounts', repoId: null, sectionId: 'accounts-claude' })
    state.openSettingsPage()
  })

  const frame = async (name: string): Promise<void> => {
    await orcaPage.waitForTimeout(HOLD_MS)
    await orcaPage.screenshot({ path: testInfo.outputPath(name), animations: 'disabled' })
  }

  const section = orcaPage.locator('#accounts-claude')
  await expect(section.getByRole('button', { name: /work@example\.com.*Active/ })).toBeVisible({
    timeout: 15_000
  })
  await section.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await frame('01-work-active.png')

  await section.getByRole('button', { name: /team@example\.com/ }).click()
  await expect(section.getByRole('button', { name: /team@example\.com.*Active/ })).toBeVisible()
  await expect(orcaPage.getByText('Claude account updated.')).toBeVisible()
  await frame('02-team-active.png')

  await section.getByRole('button', { name: /oss@example\.com/ }).click()
  await expect(section.getByRole('button', { name: /oss@example\.com.*Active/ })).toBeVisible()
  await frame('03-oss-active.png')
})
