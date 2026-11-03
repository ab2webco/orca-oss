import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal } from './helpers/orca-restart'
import { CLIP_ARGS, showcaseClip } from './helpers/showcase-clip'
import { createShowcaseRepo } from './helpers/showcase-repo'

test.use({ seedTestRepo: false, orcaAppExtraArgs: CLIP_ARGS })

// The README and site accounts clip. The roster is invented demo data
// on example.com, served by replacing the main-process handlers for this run.
const WINDOW_WIDTH = 1440
const WINDOW_HEIGHT = 900
const HOLD_MS = 1_800

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
  await attachRepoAndOpenTerminal(orcaPage, createShowcaseRepo())
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
  // Why: the isolated home has no Codex files, and the pane would warn about them with its temp path.
  const home = await electronApp.evaluate(({ app }) => app.getPath('home'))
  await mkdir(join(home, '.codex'), { recursive: true })
  await writeFile(join(home, '.codex', 'config.toml'), 'model = "gpt-5.5"\n')
  await writeFile(join(home, '.codex', 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-demo' }))
  await orcaPage.evaluate(async () => {
    const settings = await window.api.settings.set({ theme: 'dark' })
    const state = window.__store!.getState()
    window.__store!.setState({ settings })
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'accounts', repoId: null, sectionId: 'accounts-claude' })
    state.openSettingsPage()
  })

  // Why: each beat holds long enough to read before the next action.
  const hold = () => orcaPage.waitForTimeout(HOLD_MS)

  const section = orcaPage.locator('#accounts-claude')
  await expect(section.getByRole('button', { name: /work@example\.com.*Active/ })).toBeVisible({
    timeout: 15_000
  })
  await section.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  const clip = await showcaseClip(electronApp, testInfo, 'claude-accounts-switch')
  await hold()

  await section.getByRole('button', { name: /team@example\.com/ }).click()
  await expect(section.getByRole('button', { name: /team@example\.com.*Active/ })).toBeVisible()
  await expect(orcaPage.getByText('Claude account updated.')).toBeVisible()
  await hold()

  await section.getByRole('button', { name: /oss@example\.com/ }).click()
  await expect(section.getByRole('button', { name: /oss@example\.com.*Active/ })).toBeVisible()
  await hold()
  await orcaPage.waitForTimeout(1_500)
  await clip.stop()
})
