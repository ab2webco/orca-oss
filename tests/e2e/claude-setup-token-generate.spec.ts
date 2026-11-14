/**
 * Invariant: Settings → Accounts → Token → Generate runs `claude setup-token` on the account's
 * host and stores the token there, so nobody copies it (ORCA-1211). A rejected code stores
 * nothing and leaves the vault as it was.
 * Needs E2E: the unit tests fake the PTY and stub each RPC; only the real runtime proves the
 * dialog reaches the host session, the CLI runs under a real PTY, and the vault file changes.
 * The scripted `claude` prints what 2.1.325 prints. ORCA_E2E_REAL_CLAUDE_SETUP_TOKEN=1 also
 * runs the real CLI up to a rejected code; minting a real token needs a person to sign in.
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { writeSettings } from './helpers/settings-write'

const ACCOUNT_ID = 'e2e-setup-token-account'
const EMAIL = 'token-owner@example.com'
// Built, not written out, so no secret scanner reads the fixture as a leaked credential.
const FAKE_TOKEN = ['sk', 'ant', 'oat01', 'e2eFixture_'.repeat(8)].join('-')
const GOOD_CODE = 'e2e-good-code#e2e-state'
const CAPTURE = process.env.ORCA_E2E_CAPTURE === '1'

// Ink places words with cursor moves; the token stays on screen until the CLI is stopped.
const FAKE_CLAUDE = `#!/bin/bash
[ "$1" = "setup-token" ] || exit 2
url='https://claude.com/cai/oauth/authorize?code=true&client_id=e2e&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=e2e'
printf '\\e[2GOpening\\e[10Gbrowser\\e[18Gto\\e[21Gsign\\e[26Gin\\r\\n'
printf '\\e]8;id=e2e;%s\\a%s\\e]8;;\\a\\r\\n' "$url" "$url"
printf '\\e[2GPaste\\e[8Gcode\\e[13Ghere\\e[18Gif\\e[21Gprompted\\e[30G>\\r\\n'
IFS= read -r code
code="\${code%$'\\r'}"
if [ "$code" = "${GOOD_CODE}" ]; then
  printf '\\e[2GYour\\e[7GOAuth\\e[13Gtoken\\e[19G(valid\\e[26Gfor\\e[30G1\\e[32Gyear):\\r\\n\\e[2G%s\\r\\n' "$ORCA_E2E_FAKE_SETUP_TOKEN"
else
  printf "\\e[2GOAuth\\e[8Gerror:\\e[15GThat\\e[20Gcode\\e[25Gwasn't\\e[32Gaccepted.\\e[42GPress\\e[48GEnter\\e[54Gto\\e[57Gretry.\\r\\n"
fi
sleep 60
`

type Vault = { userData: string; settingsPath: string }

async function seedAccount(electronApp: ElectronApplication, page: Page): Promise<Vault> {
  const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const vault = path.join(userData, 'claude-accounts', ACCOUNT_ID, 'auth')
  mkdirSync(vault, { recursive: true })
  writeFileSync(path.join(vault, '.orca-managed-claude-auth'), `${ACCOUNT_ID}\n`)
  const settingsPath = path.join(vault, 'settings.json')
  // A key the token write must keep.
  writeFileSync(settingsPath, `${JSON.stringify({ env: { E2E_KEEP: '1' } }, null, 2)}\n`)
  const now = Date.now()
  await writeSettings(page, {
    claudeManagedAccounts: [
      {
        id: ACCOUNT_ID,
        email: EMAIL,
        managedAuthPath: vault,
        authMethod: 'subscription-oauth',
        createdAt: now,
        updatedAt: now,
        lastAuthenticatedAt: now
      }
    ]
  })
  return { userData, settingsPath }
}

/** Puts a CLI dir first on main's PATH; call it after Settings opens, whose shell PATH hydration reorders it. */
async function preferClaudeFrom(electronApp: ElectronApplication, dir: string): Promise<void> {
  await electronApp.evaluate(
    (_electron, { dir, delimiter, token }) => {
      process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ''}`
      process.env.ORCA_E2E_FAKE_SETUP_TOKEN = token
    },
    { dir, delimiter: path.delimiter, token: FAKE_TOKEN }
  )
}

function fakeClaudeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'orca-e2e-fake-claude-'))
  const bin = path.join(dir, 'claude')
  writeFileSync(bin, FAKE_CLAUDE)
  chmodSync(bin, 0o755)
  return dir
}

async function openTokenDialog(page: Page): Promise<Locator> {
  await page.evaluate(() => {
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('store unavailable')
    }
    state.openSettingsTarget({ pane: 'accounts', repoId: null })
    state.openSettingsPage()
  })
  const row = page.locator('div.rounded-md.border').filter({ hasText: EMAIL }).last()
  await row.getByRole('button', { name: 'Token', exact: true }).click({ timeout: 15_000 })
  const dialog = page.getByRole('dialog', { name: 'Long-lived token' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function capture(page: Page, testInfo: TestInfo, name: string, subject: Locator) {
  if (!CAPTURE) {
    return
  }
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(subject).toBeInViewport()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    )
    expect(overflow, `${width}px: the page scrolls sideways`).toBeLessThanOrEqual(0)
    for (const theme of ['dark', 'light'] as const) {
      await writeSettings(page, { theme })
      await page.waitForTimeout(300)
      await page.screenshot({ path: testInfo.outputPath(`${name}-${width}-${theme}.png`) })
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

async function recordWindowOpen(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.open = ((url?: string | URL) => {
      ;(window as unknown as { __openedUrl?: string }).__openedUrl = String(url)
      return null
    }) as typeof window.open
  })
}

function readVaultEnv(vault: Vault): Record<string, unknown> {
  return (JSON.parse(readFileSync(vault.settingsPath, 'utf8')) as { env: Record<string, unknown> })
    .env
}

test.describe('Generate a Claude long-lived token on the host', () => {
  test.skip(process.platform === 'win32', 'the scripted claude is a bash script')

  test('stores the token from the CLI without anyone copying it', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    const vault = await seedAccount(electronApp, orcaPage)
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    const dialog = await openTokenDialog(orcaPage)
    await capture(orcaPage, testInfo, 'generate-idle', dialog)

    await preferClaudeFrom(electronApp, fakeClaudeDir())
    await dialog.getByRole('button', { name: 'Generate token' }).click()
    const openPage = dialog.getByRole('button', { name: 'Open sign-in page' })
    await expect(openPage).toBeVisible({ timeout: 30_000 })
    await recordWindowOpen(orcaPage)
    await openPage.click()
    expect(
      await orcaPage.evaluate(() => (window as unknown as { __openedUrl?: string }).__openedUrl)
    ).toContain('redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback')
    await capture(orcaPage, testInfo, 'generate-awaiting-code', dialog)

    await dialog.getByLabel('2. Paste the code the page shows.').fill(GOOD_CODE)
    await dialog.getByRole('button', { name: 'Finish' }).click()
    await expect(
      orcaPage.getByText('Restart live Claude terminals on this account so they use it.')
    ).toBeVisible({ timeout: 30_000 })
    await expect(dialog).toBeHidden()

    expect(readVaultEnv(vault)).toEqual({ E2E_KEEP: '1', CLAUDE_CODE_OAUTH_TOKEN: FAKE_TOKEN })
    const row = orcaPage.locator('div.rounded-md.border').filter({ hasText: EMAIL }).last()
    await expect(row.locator('[data-slot="badge"]', { hasText: /^Token$/ })).toBeVisible()
    // The token never reaches the page.
    expect(await orcaPage.content()).not.toContain(FAKE_TOKEN)
  })

  test('a rejected code says why, stores nothing and keeps the old vault', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    const vault = await seedAccount(electronApp, orcaPage)
    const before = readFileSync(vault.settingsPath, 'utf8')
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    const dialog = await openTokenDialog(orcaPage)
    await preferClaudeFrom(electronApp, fakeClaudeDir())

    await dialog.getByRole('button', { name: 'Generate token' }).click()
    await dialog.getByLabel('2. Paste the code the page shows.').fill('wrong-code')
    await dialog.getByRole('button', { name: 'Finish' }).click()
    const alert = dialog.getByRole('alert')
    await expect(alert).toContainText("That code wasn't accepted.", { timeout: 30_000 })
    await expect(alert).toContainText('keeps its current login and token')
    await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible()
    await capture(orcaPage, testInfo, 'generate-failed', dialog)
    expect(readFileSync(vault.settingsPath, 'utf8')).toBe(before)

    await dialog.getByRole('button', { name: 'Paste a token instead' }).click()
    await expect(dialog.getByLabel('Token', { exact: true })).toBeVisible()
    await capture(orcaPage, testInfo, 'paste-fallback', dialog)
  })

  test('the real claude setup-token prints a link this dialog uses, and refuses a wrong code', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    test.skip(
      process.env.ORCA_E2E_REAL_CLAUDE_SETUP_TOKEN !== '1',
      'opt-in: runs the installed claude against claude.com'
    )
    const realClaude = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim()
    const vault = await seedAccount(electronApp, orcaPage)
    const before = readFileSync(vault.settingsPath, 'utf8')
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    const dialog = await openTokenDialog(orcaPage)
    await preferClaudeFrom(electronApp, path.dirname(realClaude))

    await dialog.getByRole('button', { name: 'Generate token' }).click()
    const openPage = dialog.getByRole('button', { name: 'Open sign-in page' })
    await expect(openPage).toBeVisible({ timeout: 45_000 })
    await recordWindowOpen(orcaPage)
    await openPage.click()
    const url = await orcaPage.evaluate(
      () => (window as unknown as { __openedUrl?: string }).__openedUrl ?? ''
    )
    expect(new URL(url).searchParams.get('redirect_uri')).toBe(
      'https://platform.claude.com/oauth/code/callback'
    )
    await capture(orcaPage, testInfo, 'real-awaiting-code', dialog)

    await dialog.getByLabel('2. Paste the code the page shows.').fill('e2e-bogus#e2e-state')
    await dialog.getByRole('button', { name: 'Finish' }).click()
    await expect(dialog.getByRole('alert')).toContainText("That code wasn't accepted", {
      timeout: 45_000
    })
    await capture(orcaPage, testInfo, 'real-failed', dialog)
    expect(readFileSync(vault.settingsPath, 'utf8')).toBe(before)
  })
})
