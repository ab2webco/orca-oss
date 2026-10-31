import { spawnSync } from 'node:child_process'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import {
  createRuntimeDesktopPairingOffer,
  launchPairedElectronClient,
  type PairedElectronClient
} from './helpers/paired-electron-client'
import { setTheme, setWindowWidth, THEMES, WIDTHS } from './helpers/settings-window'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  getTerminalContent,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'

// View on a live remote member opens its host's terminal in this window, read and write (ORCA-839).
const cliEntry = path.join(process.cwd(), 'out', 'cli', 'index.js')
// Why split: the typed command echoes its own text, so only the joined output proves it ran.
const READ_MARKER = 'host-said-839'
const WRITE_MARKER = 'client-typed-839'
const FAILED = "Could not open the member's terminal on its host"
const GONE = 'The host no longer has this terminal'

function revealOn(userDataDir: string, handle: string, environmentId: string) {
  const { ORCA_ENVIRONMENT: _e, ORCA_PAIRING_CODE: _p, ...clean } = process.env
  void _e
  void _p
  return spawnSync(
    process.execPath,
    [cliEntry, 'terminal', 'focus', '--terminal', handle, '--on', environmentId, '--json'],
    {
      env: { ...clean, ORCA_USER_DATA_PATH: userDataDir, ORCA_DEV_CLI_INVOCATION: '1' },
      encoding: 'utf8',
      timeout: 60_000
    }
  )
}

const activePtyIdOf = (page: Page) =>
  page.evaluate(() => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabId = worktreeId ? state?.activeTabIdByWorktree?.[worktreeId] : null
    const manager = tabId ? window.__paneManagers?.get(tabId) : null
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    return pane?.container?.dataset?.ptyId ?? null
  })

test("opens a paired host's terminal in this window through orca terminal focus --on", async ({
  orcaPage
}, testInfo) => {
  test.setTimeout(420_000)
  let client: PairedElectronClient | null = null
  try {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage)
    const hostPtyId = await waitForActivePanePtyId(orcaPage)
    await execInTerminal(orcaPage, hostPtyId, `printf '%s-%s\\n' host-said 839`)
    await waitForTerminalOutput(orcaPage, READ_MARKER)

    const offer = await createRuntimeDesktopPairingOffer(orcaPage)
    client = await launchPairedElectronClient(offer, testInfo, 'Paired terminal reveal')
    const page = client.page
    const environmentId = client.environmentId
    let handle: string | null = null
    await expect
      .poll(
        async () => {
          handle = await page.evaluate(
            async ({ environmentId, marker }) => {
              const response = await window.api.runtimeEnvironments.call({
                selector: environmentId,
                method: 'terminal.list',
                params: {},
                timeoutMs: 15_000
              })
              const terminals = response.ok
                ? (response.result as { terminals: { handle: string; preview: string }[] })
                    .terminals
                : []
              return terminals.find((one) => one.preview.includes(marker))?.handle ?? null
            },
            { environmentId, marker: READ_MARKER }
          )
          return handle
        },
        { timeout: 60_000, message: "the paired host never listed its terminal's handle" }
      )
      .not.toBeNull()
    const remotePtyId = `remote:${encodeURIComponent(environmentId)}@@${encodeURIComponent(handle!)}`
    // Why: the reveal must activate the host's worktree itself, not find an already mirrored tab.
    expect(await activePtyIdOf(page)).not.toBe(remotePtyId)

    const userDataDir = await client.app.evaluate(({ app }) => app.getPath('userData'))
    const opened = revealOn(userDataDir, handle!, environmentId)
    expect(opened.status, opened.stderr).toBe(0)
    await expect.poll(() => activePtyIdOf(page), { timeout: 60_000 }).toBe(remotePtyId)
    await waitForTerminalOutput(page, READ_MARKER, 30_000)

    await page.keyboard.type(`printf '%s-%s\\n' client-typed 839`)
    await page.keyboard.press('Enter')
    await waitForTerminalOutput(orcaPage, WRITE_MARKER, 30_000)
    await waitForTerminalOutput(page, WRITE_MARKER, 30_000)

    for (const theme of THEMES) {
      await setTheme(page, theme)
      for (const width of WIDTHS) {
        await setWindowWidth(client.app, page, width)
        // Why: at phone widths both sidebars cover the terminal this check is about.
        await page.evaluate(() => {
          window.__store!.getState().setSidebarOpen(false)
          window.__store!.getState().setRightSidebarOpen(false)
        })
        await page.waitForTimeout(500)
        expect(await getTerminalContent(page)).toContain(WRITE_MARKER)
        await page.screenshot({
          path: testInfo.outputPath(`paired-terminal-opened-${theme}-${width}.png`),
          animations: 'disabled'
        })
        const failed = revealOn(userDataDir, 'term_gone839', environmentId)
        expect(failed.status, failed.stderr).toBe(0)
        await expect(page.getByText(FAILED).first()).toBeVisible({ timeout: 30_000 })
        await expect(page.getByText(GONE).first()).toBeVisible()
        await page.screenshot({
          path: testInfo.outputPath(`paired-terminal-gone-${theme}-${width}.png`),
          animations: 'disabled'
        })
        // Why: the failure leaves the open terminal where it was.
        expect(await activePtyIdOf(page)).toBe(remotePtyId)
        await expect(page.getByText(FAILED)).toHaveCount(0, { timeout: 30_000 })
      }
    }
  } finally {
    await client?.dispose()
  }
})
