/**
 * Invariant: Settings → Accounts → Add with token adds a Claude account from a long-lived token
 * alone, with no browser login first (ORCA-1215). The account is named by the person (the token
 * reads no profile), lives in a new host vault, and is never the shared login.
 * Needs E2E: unit tests stub the RPC, IPC and PTY; only the real runtime proves the dialog
 * reaches the host's new-account session, the vault is written and the row comes back token-only.
 * The scripted `claude` prints what 2.1.325 prints; Claude's token check is stubbed in main.
 */

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { writeSettings } from './helpers/settings-write'

const EXISTING_ID = 'e2e-existing-account'
const EXISTING_EMAIL = 'existing@example.com'
const NEW_NAME = 'Team Max'
// Built, not written out, so no secret scanner reads the fixture as a leaked credential.
const FAKE_TOKEN = ['sk', 'ant', 'oat01', 'e2eNewAccount_'.repeat(7)].join('-')
const PASTED_TOKEN = ['sk', 'ant', 'oat01', 'e2ePastedToken_'.repeat(7)].join('-')
const GOOD_CODE = 'e2e-good-code#e2e-state'
const CAPTURE = process.env.ORCA_E2E_CAPTURE === '1'

const FAKE_CLAUDE = `#!/bin/bash
[ "$1" = "setup-token" ] || exit 2
url='https://claude.com/cai/oauth/authorize?code=true&client_id=e2e&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=e2e'
printf '\\e]8;id=e2e;%s\\a%s\\e]8;;\\a\\r\\n' "$url" "$url"
printf '\\e[2GPaste\\e[8Gcode\\e[13Ghere\\e[18Gif\\e[21Gprompted\\e[30G>\\r\\n'
IFS= read -r code
code="\${code%$'\\r'}"
[ "$code" = "${GOOD_CODE}" ] && printf '\\e[2GYour\\e[7GOAuth\\e[13Gtoken\\e[19G(valid\\e[26Gfor\\e[30G1\\e[32Gyear):\\r\\n\\e[2G%s\\r\\n' "$ORCA_E2E_FAKE_SETUP_TOKEN"
sleep 60
`

async function seedExistingAccount(electronApp: ElectronApplication, page: Page): Promise<string> {
  const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const vault = path.join(userData, 'claude-accounts', EXISTING_ID, 'auth')
  mkdirSync(vault, { recursive: true })
  writeFileSync(path.join(vault, '.orca-managed-claude-auth'), `${EXISTING_ID}\n`)
  writeFileSync(path.join(vault, 'settings.json'), '{}\n')
  const now = Date.now()
  await writeSettings(page, {
    claudeManagedAccounts: [
      {
        id: EXISTING_ID,
        email: EXISTING_EMAIL,
        managedAuthPath: vault,
        authMethod: 'subscription-oauth',
        createdAt: now,
        updatedAt: now,
        lastAuthenticatedAt: now
      }
    ]
  })
  return path.join(userData, 'claude-accounts')
}

/** Main answers Claude's token check for the fixtures only. */
async function stubTokenCheck(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(
    ({ net }, accepted) => {
      const realFetch = net.fetch.bind(net)
      net.fetch = (async (input: string, init?: RequestInit) => {
        const auth = new Headers(init?.headers).get('authorization') ?? ''
        if (String(input).includes('/v1/models') && accepted.some((t) => auth === `Bearer ${t}`)) {
          return new Response('{"data":[]}', { status: 200 })
        }
        return realFetch(input, init)
      }) as typeof net.fetch
    },
    [FAKE_TOKEN, PASTED_TOKEN]
  )
}

/** Call right before Generate: Settings re-hydrates the shell PATH and would put the real CLI first. */
async function preferFakeClaude(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(
    (_electron, { dir, delimiter, token }) => {
      process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ''}`
      process.env.ORCA_E2E_FAKE_SETUP_TOKEN = token
    },
    { dir: fakeClaudeDir(), delimiter: path.delimiter, token: FAKE_TOKEN }
  )
}

function fakeClaudeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'orca-e2e-fake-claude-'))
  const bin = path.join(dir, 'claude')
  writeFileSync(bin, FAKE_CLAUDE)
  chmodSync(bin, 0o755)
  return dir
}

async function openAccounts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('store unavailable')
    }
    state.openSettingsTarget({ pane: 'accounts', repoId: null })
    state.openSettingsPage()
  })
}

async function openAddDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Add with token' }).click({ timeout: 15_000 })
  const dialog = page.getByRole('dialog', { name: 'Add account with a token' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function capture(page: Page, testInfo: TestInfo, name: string, subject: Locator) {
  if (!CAPTURE) {
    return
  }
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await subject.scrollIntoViewIfNeeded()
    await expect(subject).toBeInViewport()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    )
    expect(overflow, `${width}px: the page scrolls sideways`).toBeLessThanOrEqual(0)
    const box = await subject.boundingBox()
    expect(box && box.x >= 0 && box.x + box.width <= width, `${width}px: cut off`).toBe(true)
    const title = subject.getByRole('heading').first()
    const close = subject.getByRole('button', { name: 'Close' })
    if ((await title.count()) > 0 && (await close.count()) > 0) {
      const range = await title.evaluate((node) => {
        const r = document.createRange()
        r.selectNodeContents(node)
        return Array.from(r.getClientRects()).map((rect) => [rect.right, rect.top, rect.bottom])
      })
      const closeBox = (await close.boundingBox())!
      // Why the text and not the element: the title box spans the row, only its glyphs can collide.
      const hits = range.filter(
        ([right, top, bottom]) =>
          right > closeBox.x - 4 && top < closeBox.y + closeBox.height && bottom > closeBox.y
      )
      expect(hits, `${width}px: the title runs into the close button`).toEqual([])
    }
    for (const theme of ['dark', 'light'] as const) {
      await writeSettings(page, { theme })
      await page.waitForTimeout(300)
      await page.screenshot({ path: testInfo.outputPath(`${name}-${width}-${theme}.png`) })
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

function accountRow(page: Page, name: string): Locator {
  return page.locator('div.rounded-md.border').filter({ hasText: name }).last()
}

function vaultTokens(accountsRoot: string): string[] {
  return readdirSync(accountsRoot).flatMap((id) => {
    const env = (
      JSON.parse(readFileSync(path.join(accountsRoot, id, 'auth', 'settings.json'), 'utf8')) as {
        env?: Record<string, string>
      }
    ).env
    return env?.CLAUDE_CODE_OAUTH_TOKEN ? [env.CLAUDE_CODE_OAUTH_TOKEN] : []
  })
}

test.describe('Add a Claude account from a long-lived token', () => {
  test.skip(process.platform === 'win32', 'the scripted claude is a bash script')

  test('generates the token on the host and adds a token-only account under the typed name', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    const accountsRoot = await seedExistingAccount(electronApp, orcaPage)
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await openAccounts(orcaPage)
    await stubTokenCheck(electronApp)
    const dialog = await openAddDialog(orcaPage)
    await expect(dialog.getByRole('button', { name: 'Generate token' })).toBeDisabled()
    await capture(orcaPage, testInfo, 'add-token-idle', dialog)

    // A name that is already an account is refused before any sign-in starts.
    await dialog.getByLabel('Name or email').fill(EXISTING_EMAIL)
    await dialog.getByRole('button', { name: 'Generate token' }).click()
    const alert = dialog.getByRole('alert')
    await expect(alert).toContainText('is already added', { timeout: 30_000 })
    await expect(alert).toContainText('Nothing was added.')
    await capture(orcaPage, testInfo, 'add-token-duplicate', dialog)

    await dialog.getByLabel('Name or email').fill(NEW_NAME)
    await preferFakeClaude(electronApp)
    await dialog.getByRole('button', { name: 'Generate token' }).click()
    await expect(dialog.getByRole('button', { name: 'Open sign-in page' })).toBeVisible({
      timeout: 30_000
    })
    await expect(dialog).toContainText(`sign in as ${NEW_NAME}`)
    await capture(orcaPage, testInfo, 'add-token-awaiting-code', dialog)

    await dialog.getByLabel('2. Paste the code the page shows.').fill(GOOD_CODE)
    await dialog.getByRole('button', { name: 'Finish' }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })

    const row = accountRow(orcaPage, NEW_NAME)
    await expect(row.locator('[data-slot="badge"]', { hasText: /^Token only$/ })).toBeVisible()
    // Never the shared login: the row's select button stays off.
    await expect(row.getByRole('button').filter({ hasText: NEW_NAME }).first()).toBeDisabled()
    expect(vaultTokens(accountsRoot)).toEqual([FAKE_TOKEN])
    expect(await orcaPage.content()).not.toContain(FAKE_TOKEN)
    await capture(orcaPage, testInfo, 'add-token-row', row)
  })

  test('adds from a pasted token and refuses the same token twice', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    const accountsRoot = await seedExistingAccount(electronApp, orcaPage)
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await openAccounts(orcaPage)
    await stubTokenCheck(electronApp)

    let dialog = await openAddDialog(orcaPage)
    await dialog.getByLabel('Name or email').fill(NEW_NAME)
    await dialog.getByRole('button', { name: 'Paste a token instead' }).click()
    await dialog.getByLabel('Token', { exact: true }).fill(PASTED_TOKEN)
    await capture(orcaPage, testInfo, 'add-token-paste', dialog)
    await dialog.getByRole('button', { name: 'Add account' }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })
    await expect(
      accountRow(orcaPage, NEW_NAME).locator('[data-slot="badge"]', { hasText: /^Token only$/ })
    ).toBeVisible()

    dialog = await openAddDialog(orcaPage)
    await dialog.getByLabel('Name or email').fill('Someone else')
    await dialog.getByRole('button', { name: 'Paste a token instead' }).click()
    await dialog.getByLabel('Token', { exact: true }).fill(PASTED_TOKEN)
    await dialog.getByRole('button', { name: 'Add account' }).click()
    await expect(dialog.getByRole('alert')).toHaveText(
      `This token is already stored for ${NEW_NAME}.Nothing was added.`
    )
    await capture(orcaPage, testInfo, 'add-token-paste-duplicate', dialog)
    expect(vaultTokens(accountsRoot)).toEqual([PASTED_TOKEN])
    expect(await orcaPage.content()).not.toContain(PASTED_TOKEN)
  })
})
