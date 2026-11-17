import type { Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  splitActiveTerminalPane,
  waitForActiveTerminalManager,
  waitForPaneCount,
  waitForPaneIdentitySnapshot
} from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'
import { worktreeRow } from './worktree-row-locators'

const QUESTION = 'Apply the migration now or at release?'
const WIDTHS = [1440, 768, 390, 320]

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

type Seed = { state: 'waiting' | 'working' | 'done' }

async function seedAgent(page: Page, paneKey: string, seed: Seed): Promise<void> {
  await page.evaluate(
    ({ paneKey, seed, question }) => {
      const now = Date.now()
      const base = { prompt: 'Fix the checks panel tooltip', agentType: 'claude' as const }
      const payload =
        seed.state === 'waiting'
          ? {
              ...base,
              state: 'blocked' as const,
              toolName: 'AskUserQuestion',
              interactivePrompt: JSON.stringify({
                questions: [{ question, multiSelect: false, options: [{ label: 'Now' }] }]
              })
            }
          : seed.state === 'working'
            ? {
                ...base,
                state: 'working' as const,
                toolName: 'Bash',
                toolInput: 'gh pr checks 912'
              }
            : {
                ...base,
                state: 'done' as const,
                lastAssistantMessage: 'Validation added and the tests pass.'
              }
      window.__store!.getState().setAgentStatus(paneKey, payload, 'Claude', {
        updatedAt: now - 8 * 60_000,
        stateStartedAt: now - 8 * 60_000
      })
    },
    { paneKey, seed, question: QUESTION }
  )
}

/** A one-agent session on another host, with the worktree facts a real one carries. */
async function seedRemoteSession(page: Page, paneKey: string): Promise<void> {
  await page.evaluate((paneKey) => {
    const store = window.__store!
    const state = store.getState()
    const [template] = Object.values(state.worktreesByRepo).flat()
    const sshTargetLabels = new Map(state.sshTargetLabels)
    sshTargetLabels.set('imac-id', 'imac')
    // Why its own repo key: a worktree refresh replaces a real repo's list and would drop this one.
    store.setState({
      sshTargetLabels,
      worktreesByRepo: {
        ...state.worktreesByRepo,
        'e2e-on-imac': [
          {
            ...template!,
            id: 'on-imac',
            path: '/on-imac',
            displayName: 'cin-1145',
            hostId: 'ssh:imac-id'
          }
        ]
      },
      tabsByWorktree: {
        ...state.tabsByWorktree,
        'on-imac': [{ ...state.tabsByWorktree[template!.id]![0]!, id: paneKey.split(':')[0]! }]
      }
    })
    store
      .getState()
      .setAgentStatus(
        paneKey,
        { state: 'working', prompt: 'Add booking validation', agentType: 'claude' },
        'Claude'
      )
  }, paneKey)
}

/** Every width and theme; the row must stay inside the sidebar at each width. */
async function capture(page: Page, testInfo: TestInfo, name: string, row: Locator): Promise<void> {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    const fits = await row.evaluate((node) => {
      const sidebar = node.closest('[data-worktree-sidebar]')!.getBoundingClientRect()
      const box = node.getBoundingClientRect()
      return box.right <= sidebar.right + 0.5 && box.left >= sidebar.left - 0.5
    })
    expect(fits, `${name} row overflows the sidebar at ${width}`).toBe(true)
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(page, theme)
      const file = `sidebar-solo-${name}-${width}-${theme}.png`
      const shot = await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(file)
      })
      // Why attached: CI keeps test-results only on failure; the JSON report carries captures on green runs too.
      await testInfo.attach(file, { body: shot, contentType: 'image/png' })
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

// ORCA-1149 S9: a worktree with exactly one live agent reads as V30's soloRow.
test('a one-agent worktree draws V30 solo row; two agents keep the inline list', async ({
  orcaPage
}, testInfo) => {
  test.setTimeout(600_000)
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage, 30_000)
  await waitForPaneCount(orcaPage, 1, 30_000)
  const single = await waitForPaneIdentitySnapshot(orcaPage, 1)
  const paneKey = `${single.tabId}:${single.panes[0]!.leafId}`
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    if (!state.worktreeCardProperties.includes('inline-agents')) {
      state.setWorktreeCardProperties([...state.worktreeCardProperties, 'inline-agents'])
    }
    state.setRightSidebarOpen(false)
  })

  const card = worktreeRow(orcaPage, worktreeId)
  const row = card.locator('[data-sidebar-solo-row]')
  const act = row.locator('[data-team-row-part="act"]')

  await seedAgent(orcaPage, paneKey, { state: 'waiting' })
  await expect(act).toHaveText(QUESTION)
  await expect(act).toHaveAttribute('data-asks', '')
  await expect(row.locator('[data-status-glyph="question"]')).toBeVisible()
  await expect(card.locator('[aria-label="Agents"]')).toHaveCount(0)
  await capture(orcaPage, testInfo, 'waiting', row)

  await seedAgent(orcaPage, paneKey, { state: 'working' })
  await expect(act).toHaveText('Bash · gh pr checks 912')
  await expect(act).not.toHaveAttribute('data-asks', '')
  await capture(orcaPage, testInfo, 'working', row)

  await seedAgent(orcaPage, paneKey, { state: 'done' })
  await expect(act).toHaveText('Validation added and the tests pass.')
  await capture(orcaPage, testInfo, 'done', row)

  // The inline list's actions stay on the row: click focuses the pane, the X dismisses.
  // Why the ack key: only the agent row's focus acks its pane; a click that reached the card would not.
  await orcaPage.evaluate(() => {
    const acks: string[] = []
    ;(window as unknown as { __soloAcks: string[] }).__soloAcks = acks
    window.addEventListener('orca-focus-terminal-pane', (event) => {
      const ack = (event as CustomEvent<{ ackPaneKeyOnSuccess?: string }>).detail
        .ackPaneKeyOnSuccess
      if (ack) {
        acks.push(ack)
      }
    })
  })
  await row.locator('[data-team-row-part="name"]').click()
  await expect
    .poll(() => orcaPage.evaluate(() => (window as unknown as { __soloAcks: string[] }).__soloAcks))
    .toContain(paneKey)
  await row.hover()
  await row.getByRole('button', { name: 'Dismiss agent' }).click()
  await expect(row).toHaveCount(0)

  const remotePane = 'tab-imac:66666666-6666-4666-8666-666666666666'
  await seedRemoteSession(orcaPage, remotePane)
  const remoteRow = worktreeRow(orcaPage, 'on-imac').locator('[data-sidebar-solo-row]')
  const remoteExtra = remoteRow.locator('[data-team-row-part="extra"]')
  const imacHeader = orcaPage.locator(
    '[data-worktree-sidebar] [data-host-header-drag-id="ssh:imac-id"]'
  )
  // Under its host header, which already names imac, the row does not repeat the host.
  await expect(imacHeader).toContainText('imac')
  await expect(remoteRow).toBeVisible()
  await expect(remoteExtra).toHaveCount(0)
  await capture(orcaPage, testInfo, 'remote', remoteRow)
  // Filtered to that host alone, no header is drawn, so the row names it.
  await orcaPage.evaluate(() =>
    window.__store!.getState().setVisibleWorkspaceHostIds(['ssh:imac-id'])
  )
  await expect(imacHeader).toHaveCount(0)
  await expect(remoteExtra).toHaveText('imac')
  await capture(orcaPage, testInfo, 'remote-filtered', remoteRow)
  await orcaPage.evaluate(() => window.__store!.getState().setVisibleWorkspaceHostIds(null))
  await orcaPage.evaluate((pane) => window.__store!.getState().dropAgentStatus(pane), remotePane)

  await splitActiveTerminalPane(orcaPage, 'vertical')
  await waitForPaneCount(orcaPage, 2)
  const pair = await waitForPaneIdentitySnapshot(orcaPage, 2)
  for (const pane of pair.panes) {
    await seedAgent(orcaPage, `${pair.tabId}:${pane.leafId}`, { state: 'working' })
  }
  const list = card.locator('[aria-label="Agents"]')
  await expect(list).toBeVisible()
  await expect(card.locator('[data-sidebar-solo-row]')).toHaveCount(0)
  await capture(orcaPage, testInfo, 'two-agents', list)
})
