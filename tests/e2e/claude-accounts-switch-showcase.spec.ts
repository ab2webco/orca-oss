import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal } from './helpers/orca-restart'
import { CLIP_ARGS, showcaseClip } from './helpers/showcase-clip'
import { glideTo, showPointer } from './helpers/showcase-pointer'
import { createShowcaseRepo } from './helpers/showcase-repo'
import { writeSettings } from './helpers/settings-write'

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
  await writeSettings(orcaPage, { theme: 'dark' })
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'accounts', repoId: null, sectionId: 'accounts-claude' })
    state.openSettingsPage()
  })
  // Why: invented accounts are never checked, so the store gets a verified sign-in and quota per account.
  await orcaPage.evaluate((at) => {
    const usage = (session: number, weekly: number) => ({
      provider: 'claude' as const,
      session: {
        usedPercent: session,
        windowMinutes: 300,
        resetsAt: at + 2_400_000,
        resetDescription: null
      },
      weekly: {
        usedPercent: weekly,
        windowMinutes: 10_080,
        resetsAt: at + 259_200_000,
        resetDescription: null
      },
      updatedAt: at,
      error: null,
      status: 'ok' as const
    })
    const usageById: Record<string, ReturnType<typeof usage>> = {
      'demo-work': usage(82, 64),
      'demo-team': usage(18, 31),
      'demo-oss': usage(6, 12)
    }
    const store = window.__store!
    const demo = window as unknown as { demoActive: string; demoSeed: () => void }
    demo.demoActive = 'demo-work'
    const seeded = new WeakSet<object>()
    demo.demoSeed = () => {
      const ids = Object.keys(usageById)
      const next = {
        ...store.getState().rateLimits,
        claude: usageById[demo.demoActive]!,
        inactiveClaudeAccounts: ids
          .filter((id) => id !== demo.demoActive)
          .map((id) => ({
            accountId: id,
            rateLimits: usageById[id]!,
            updatedAt: at,
            isFetching: false
          })),
        claudeAccountAuth: ids.map((id) => ({
          accountId: id,
          state: 'authenticated' as const,
          checkedAt: at - 240_000,
          failure: null,
          undecided: null,
          undecidedAt: null,
          checking: false
        }))
      }
      seeded.add(next)
      store.setState({ rateLimits: next })
    }
    store.subscribe((state) => {
      if (!seeded.has(state.rateLimits)) {
        demo.demoSeed()
      }
    })
    demo.demoSeed()
  }, now)

  // Why: each beat holds long enough to read before the next action.
  const hold = () => orcaPage.waitForTimeout(HOLD_MS)

  const section = orcaPage.locator('#accounts-claude')
  await expect(section.getByText('Sign-in verified 4m ago')).toHaveCount(3)
  await expect(section.getByRole('button', { name: /work@example\.com.*Active/ })).toBeVisible({
    timeout: 15_000
  })
  await section.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await showPointer(orcaPage, WINDOW_WIDTH * 0.7, WINDOW_HEIGHT * 0.8)
  const clip = await showcaseClip(electronApp, testInfo, 'claude-accounts-switch')
  await hold()

  await glideTo(orcaPage, section.getByText('team@example.com', { exact: true }))
  await orcaPage.evaluate(() => {
    const demo = window as unknown as { demoActive: string; demoSeed: () => void }
    demo.demoActive = 'demo-team'
    demo.demoSeed()
  })
  await orcaPage.mouse.down()
  await orcaPage.mouse.up()
  await expect(section.getByRole('button', { name: /team@example\.com.*Active/ })).toBeVisible()
  await expect(orcaPage.getByText('Claude account updated.')).toBeVisible()
  await hold()

  await glideTo(orcaPage, section.getByText('oss@example.com', { exact: true }))
  await orcaPage.evaluate(() => {
    const demo = window as unknown as { demoActive: string; demoSeed: () => void }
    demo.demoActive = 'demo-oss'
    demo.demoSeed()
  })
  await orcaPage.mouse.down()
  await orcaPage.mouse.up()
  await expect(section.getByRole('button', { name: /oss@example\.com.*Active/ })).toBeVisible()
  await orcaPage.waitForTimeout(1_500)
  await clip.stop()
})
