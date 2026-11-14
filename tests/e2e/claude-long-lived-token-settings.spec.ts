/**
 * Invariant: Settings → Accounts stores a Claude long-lived token through the real preload
 * channel, marks the account that holds one, and offers removal only there (ORCA-1039).
 * Needs E2E: the unit tests stub each side of `claudeAccounts:setLongLivedToken`; only the real
 * preload proves the renderer reaches the main handler, and only a layout engine shows the extra
 * row action fitting at phone width.
 */

import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { writeSettings } from './helpers/settings-write'

const FIXTURE_TOKEN = 'fixture-long-lived-token'
const NOW = Date.now()

function account(id: string, email: string, longLivedTokenSetAt: number | null) {
  return {
    id,
    email,
    authMethod: 'subscription-oauth' as const,
    longLivedTokenSetAt,
    createdAt: NOW,
    updatedAt: NOW,
    lastAuthenticatedAt: NOW
  }
}

const INITIAL_STATE = {
  accounts: [
    account('token-account', 'with-token@example.com', NOW),
    account('plain-account', 'without-token@example.com', null)
  ],
  activeAccountId: 'token-account',
  activeAccountIdsByRuntime: { host: 'token-account', wsl: {} }
}

async function stubAccountIpc(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }, initial) => {
    let state = initial
    const calls: { accountId: string; tokenLength: number | null }[] = []
    ;(globalThis as { __tokenCalls?: typeof calls }).__tokenCalls = calls
    ipcMain.removeHandler('claudeAccounts:list')
    ipcMain.handle('claudeAccounts:list', () => state)
    ipcMain.removeHandler('claudeAccounts:setLongLivedToken')
    ipcMain.handle(
      'claudeAccounts:setLongLivedToken',
      (_event, args: { accountId: string; token: string | null }) => {
        // Only the length is kept so a failing assertion can never print the value.
        calls.push({ accountId: args.accountId, tokenLength: args.token?.length ?? null })
        state = {
          ...state,
          accounts: state.accounts.map((entry) =>
            entry.id === args.accountId
              ? { ...entry, longLivedTokenSetAt: args.token === null ? null : Date.now() }
              : entry
          )
        }
        return state
      }
    )
  }, INITIAL_STATE)
}

async function tokenCalls(
  electronApp: ElectronApplication
): Promise<{ accountId: string; tokenLength: number | null }[]> {
  return electronApp.evaluate(
    () =>
      (globalThis as { __tokenCalls?: { accountId: string; tokenLength: number | null }[] })
        .__tokenCalls ?? []
  )
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

// The pane's own container also holds every email, so exclude the other row's.
function row(page: Page, email: string, otherEmail: string) {
  return page
    .locator('div.rounded-md.border')
    .filter({ hasText: email })
    .filter({ hasNotText: otherEmail })
    .first()
}

function tokenBadge(accountRow: ReturnType<typeof row>) {
  return accountRow.locator('[data-slot="badge"]', { hasText: /^Token$/ })
}

function tokenButton(accountRow: ReturnType<typeof row>) {
  return accountRow.getByRole('button', { name: 'Token', exact: true })
}

async function screenshotAllWidths(
  page: Page,
  testInfo: TestInfo,
  name: string,
  subject: ReturnType<Page['locator']>,
  // A shrink-0 action strip once squeezed the email to zero width at 768.
  readableText?: ReturnType<Page['locator']>
): Promise<void> {
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    // A resize reflows the pane; without this a narrow capture shows only the page header.
    await subject.scrollIntoViewIfNeeded()
    await expect(subject).toBeInViewport()
    if (readableText) {
      const textWidth = await readableText.evaluate((node) => node.getBoundingClientRect().width)
      expect(textWidth, `${width}px: the account email collapsed`).toBeGreaterThan(80)
    }
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(page, theme)
      // A row action pushed out of view would still be "visible" to Playwright.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      )
      expect(overflow, `${width}px ${theme}: the page scrolls sideways`).toBeLessThanOrEqual(0)
      await page.screenshot({ path: testInfo.outputPath(`${name}-${width}-${theme}.png`) })
    }
  }
}

test('stores, marks and removes a Claude long-lived token from Settings', async ({
  electronApp,
  orcaPage
}, testInfo: TestInfo) => {
  await stubAccountIpc(electronApp)
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('store unavailable')
    }
    state.openSettingsTarget({ pane: 'accounts', repoId: null })
    state.openSettingsPage()
  })

  const withToken = row(orcaPage, 'with-token@example.com', 'without-token@example.com')
  const withoutToken = row(orcaPage, 'without-token@example.com', 'with-token@example.com')
  await expect(tokenBadge(withToken)).toBeVisible({ timeout: 15_000 })
  await expect(tokenBadge(withoutToken)).toHaveCount(0)
  await screenshotAllWidths(
    orcaPage,
    testInfo,
    'rows',
    withoutToken,
    withoutToken.getByText('without-token@example.com')
  )
  await orcaPage.setViewportSize({ width: 1440, height: 900 })

  // ORCA-1039: the System default row read 'Use your current this device Claude login.'
  await expect(orcaPage.getByText('Use the Claude login on this device.')).toBeVisible()
  await writeSettings(orcaPage, { uiLanguage: 'es' })
  const systemDefaultEs = orcaPage.getByText(
    'Usa el inicio de sesión de Claude en este dispositivo.'
  )
  await expect(systemDefaultEs).toBeVisible()
  for (const width of [1440, 320]) {
    await orcaPage.setViewportSize({ width, height: 900 })
    await systemDefaultEs.scrollIntoViewIfNeeded()
    // The sentence names where the login lives; cut at 320 it lost exactly that.
    const cut = await systemDefaultEs.evaluate((node) => node.scrollWidth - node.clientWidth)
    expect(cut, `${width}px: the System default line is cut`).toBeLessThanOrEqual(0)
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(orcaPage, theme)
      await orcaPage.screenshot({
        path: testInfo.outputPath(`system-default-es-${width}-${theme}.png`)
      })
    }
  }
  await writeSettings(orcaPage, { uiLanguage: 'en' })
  await orcaPage.setViewportSize({ width: 1440, height: 900 })

  await tokenButton(withoutToken).click()
  const dialog = orcaPage.getByRole('dialog', { name: 'Long-lived token' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Remove token' })).toHaveCount(0)
  await dialog.getByLabel('Token').fill(FIXTURE_TOKEN)
  await screenshotAllWidths(orcaPage, testInfo, 'dialog', dialog)
  await dialog.getByRole('button', { name: 'Save token' }).click()
  // A pane reads the vault env only at startup, so a live one keeps the old login until restarted.
  // Read before the dialog's exit: headless CI paints ~1 frame/s, so the exit outlasted the 4 s toast.
  await expect(
    orcaPage.getByText('Restart live Claude terminals on this account so they use it.')
  ).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('saved-toast-320.png') })
  await expect(dialog).toBeHidden()

  expect(await tokenCalls(electronApp)).toEqual([
    { accountId: 'plain-account', tokenLength: FIXTURE_TOKEN.length }
  ])
  await expect(tokenBadge(withoutToken)).toBeVisible()

  await tokenButton(withToken).click()
  await expect(dialog.getByLabel('Token')).toHaveValue('')
  await screenshotAllWidths(orcaPage, testInfo, 'dialog-stored', dialog)
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await dialog.getByRole('button', { name: 'Remove token' }).click()
  await expect(dialog).toBeHidden()
  expect((await tokenCalls(electronApp)).at(-1)).toEqual({
    accountId: 'token-account',
    tokenLength: null
  })
  await expect(tokenBadge(withToken)).toHaveCount(0)
})
