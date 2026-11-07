import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { WIDTHS } from './helpers/settings-window'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'

const GB = 1024 ** 3
// Why: one capture per toggle value and width outruns the CI budget; ORCA_CAPTURE_EVIDENCE=1 runs it.
const CAPTURE_EVIDENCE = process.env.ORCA_CAPTURE_EVIDENCE === '1'
const SETTLE_MS = 3_000

/** What the lead's `game.state` gets on top of the real answer: work on every tab and a Jev row. */
const OVERLAY = {
  project: {
    reviews: {
      provider: 'github',
      total: 1,
      url: 'https://github.com/o/r/pulls',
      items: [
        {
          id: '#924',
          title: 'Keep the reflow column',
          url: 'https://github.com/o/r/pull/924',
          status: 'success'
        }
      ]
    },
    todo: { provider: 'plane', total: 0, url: null, items: [] },
    queue: {
      provider: 'github',
      entries: [
        {
          id: '#951',
          title: 'Launch E2E waits',
          url: 'https://github.com/o/r/pull/951',
          position: 1,
          state: 'checks',
          since: null
        }
      ]
    }
  },
  hostCapacity: [
    {
      host: 'local',
      running: 1,
      cap: 4,
      status: 'ok',
      cpuCoreCount: 14,
      totalMemory: 36 * GB,
      availableMemory: 21 * GB,
      loadAverage1m: 3
    },
    {
      host: 'm1',
      running: 0,
      cap: 2,
      status: 'ok',
      cpuCoreCount: 8,
      totalMemory: 16 * GB,
      availableMemory: 9 * GB,
      loadAverage1m: 1
    }
  ]
}
const ADVISOR = {
  model: 'Opus 5.5',
  effort: 'high',
  pinned: { model: false, effort: false },
  line: 'Approved Opus 5.5 for ORCA-1044'
}

type RuntimeCall = (
  event: unknown,
  args: { method: string }
) => Promise<{ result?: { agents?: { isLeader?: boolean }[] } }>

async function overlayGameState(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(
    ({ ipcMain }, { overlay, advisor }) => {
      const { _invokeHandlers: handlers } = ipcMain as unknown as {
        _invokeHandlers: Map<string, RuntimeCall>
      }
      const real = handlers.get('runtime:call')!
      ipcMain.removeHandler('runtime:call')
      ipcMain.handle('runtime:call', async (event, args: { method: string }) => {
        const response = await real(event, args)
        if (args.method !== 'game.state' || !response.result) {
          return response
        }
        const agents = (response.result.agents ?? []).map((agent) =>
          agent.isLeader ? { ...agent, advisor } : agent
        )
        return { ...response, result: { ...response.result, ...overlay, agents } }
      })
    },
    { overlay: OVERLAY, advisor: ADVISOR }
  )
}

async function setPanel(page: Page, panel: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (next) => window.__store!.getState().updateSettings({ orchestratorGame: { panel: next } }),
    panel
  )
}

const CASES = [
  { name: 'all-on', panel: {}, hidden: [] as string[], advisor: true },
  { name: 'prs-off', panel: { tabs: { prs: false } }, hidden: ['PRs'], advisor: true },
  { name: 'queue-off', panel: { tabs: { queue: false } }, hidden: ['Queue'], advisor: true },
  {
    name: 'machines-off',
    panel: { tabs: { machines: false } },
    hidden: ['Machines'],
    advisor: true
  },
  { name: 'advisor-off', panel: { advisor: false }, hidden: [] as string[], advisor: false }
] as const

// A real lead's game.state drives the panel; only the global Settings layer changes between captures.
test('each panel setting changes the Team panel: PRs, Queue and Machines tabs and the Advisor row', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(600_000)
  const agent = createStdinLoggingAgent()
  try {
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActivePanePtyId(orcaPage)
    const pane = await waitForActivePaneHookDescriptor(orcaPage)
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = new RuntimeClient(userDataDir, 30_000, null, null)
    const lead = (
      await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
        paneKey: pane.paneKey
      })
    ).result.terminal.handle
    await client.call('terminal.send', { terminal: lead, text: agent.command, enter: true })
    await expect
      .poll(async () => {
        const registered = await client.call<{ registered: boolean }>('game.leadRegister', {
          terminalHandle: lead,
          project: 'e2e',
          label: 'Alfred'
        })
        return registered.result.registered
      })
      .toBe(true)
    await emitCodexHookStatus(await readHookEndpoint(electronApp), {
      paneKey: pane.paneKey,
      worktreeId,
      state: 'working',
      prompt: 'Lead the team'
    })
    await expect(orcaPage.getByText('Workspace board moved to the bottom bar').first()).toBeHidden({
      timeout: 15_000
    })

    await overlayGameState(electronApp)
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.updateSettings({ uiLanguage: 'en' })
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    await expect(panel.getByRole('tab', { name: 'Machines' })).toBeVisible({ timeout: 30_000 })

    // Soft, so one run names every setting that changes nothing and still captures each value.
    // SETTLE_MS: game.state's own panel.tabs hides a tab only on the next 20 s poll; a toggle must show now.
    for (const one of CASES) {
      await setPanel(orcaPage, { look: 'plain', ...one.panel })
      await panel.getByRole('tab', { name: 'Team' }).click()
      for (const name of ['PRs', 'Queue', 'Machines']) {
        await expect
          .soft(panel.getByRole('tab', { name }), `${one.name}: ${name}`)
          .toHaveCount((one.hidden as readonly string[]).includes(name) ? 0 : 1, {
            timeout: SETTLE_MS
          })
      }
      await expect
        .soft(panel.locator('[data-team-card="advisor"]'), `${one.name}: advisor`)
        .toHaveCount(one.advisor ? 1 : 0, { timeout: SETTLE_MS })
      if (!CAPTURE_EVIDENCE) {
        continue
      }
      await orcaPage.mouse.move(0, 0)
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        await panel.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`${one.name}-${width}.png`)
        })
      }
      await orcaPage.setViewportSize({ width: 1440, height: 900 })
    }

    // The selected tab falls back to Team when its toggle hides it, as V28 does.
    await setPanel(orcaPage, { look: 'plain' })
    await panel.getByRole('tab', { name: 'Queue' }).click()
    await setPanel(orcaPage, { look: 'plain', tabs: { queue: false } })
    await expect(panel.getByRole('tab', { name: 'Team' })).toHaveAttribute(
      'aria-selected',
      'true',
      {
        timeout: SETTLE_MS
      }
    )

    // At 320 the 219 px panel cannot fit five tabs: the strip must say more lie on each side.
    await setPanel(orcaPage, { look: 'plain' })
    // Why first: once Inbox opens, its sub-tab list is a second tablist inside the panel.
    const strip = panel.getByRole('tablist').first()
    await orcaPage.setViewportSize({ width: 320, height: 900 })
    await panel.getByRole('tab', { name: 'Team' }).click()
    await orcaPage.mouse.move(0, 0)
    await expect(strip).toHaveAttribute('data-overflow-end', 'true')
    await expect(strip).toHaveAttribute('data-overflow-start', 'false')
    if (CAPTURE_EVIDENCE) {
      await panel.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('strip-320-start.png')
      })
    }
    await panel.getByRole('tab', { name: 'Machines' }).click()
    await orcaPage.mouse.move(0, 0)
    await expect(strip).toHaveAttribute('data-overflow-start', 'true')
    await expect(strip).toHaveAttribute('data-overflow-end', 'false')
    if (CAPTURE_EVIDENCE) {
      await panel.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('strip-320-end.png')
      })
    }
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await expect(strip).toHaveAttribute('data-overflow-start', 'false')
    await expect(strip).toHaveAttribute('data-overflow-end', 'false')

    // ORCA-1094 F9: at the default 280 sidebar and wider all five tabs fit, in either language;
    // at 220 the strip scrolls with a cue and the selected tab is scrolled into view.
    const edges = (): Promise<{ panel: number; scroll: number; client: number; cut: string[] }> =>
      strip.evaluate((list) => {
        const right = list.getBoundingClientRect().right
        const cut = [...list.querySelectorAll<HTMLElement>('[role="tab"]')]
          .filter((tab) => tab.getBoundingClientRect().right > right + 0.5)
          .map(
            (tab) =>
              `${tab.textContent} ends ${Math.round(tab.getBoundingClientRect().right - right)} px past`
          )
        return { panel: right, scroll: list.scrollWidth, client: list.clientWidth, cut }
      })
    // Why a question: Inbox draws its sub-tabs only with something in it, and the count widens its tab.
    await client.call('game.ownerAsk', {
      worktreeId,
      terminalHandle: lead,
      ticket: 'ORCA-12',
      question: 'Merge #923 now or wait for #915 first?',
      options: ['Merge now', 'Wait for #915']
    })
    await orcaPage.evaluate(() => window.dispatchEvent(new Event('focus')))
    for (const language of ['es', 'en'] as const) {
      await orcaPage.evaluate(
        (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
        language
      )
      const tabs = strip.getByRole('tab')
      await expect(tabs).toHaveCount(5)
      for (const width of [280, 2000]) {
        await orcaPage.evaluate(
          (next) => window.__store!.getState().setRightSidebarWidth(next),
          width
        )
        await tabs.first().click()
        await expect
          .poll(async () => (await edges()).cut, {
            message: `${language} ${width}: tabs past the edge`
          })
          .toEqual([])
        const fit = await edges()
        expect(fit.scroll, `${language} ${width}: the strip scrolls`).toBeLessThanOrEqual(
          fit.client
        )
        await expect(strip).toHaveAttribute('data-overflow-end', 'false')
      }
      await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarWidth(220))
      await tabs.first().click()
      await expect(strip).toHaveAttribute('data-overflow-end', 'true')
      await tabs.last().click()
      await expect
        .poll(async () => {
          const box = await tabs.last().boundingBox()
          return box ? box.x + box.width <= (await edges()).panel + 0.5 : false
        })
        .toBe(true)

      // The Inbox sub-tabs stay on one line at 280, as V28 `.subs` does; what does not fit scrolls
      // behind a cue, and the selected one is scrolled into view.
      await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarWidth(280))
      await tabs.nth(1).click()
      const subList = panel.getByTestId('team-panel-inbox').getByRole('tablist')
      const subs = await subList.evaluate((list) => ({
        tops: [...list.querySelectorAll('[role="tab"]')].map((sub) =>
          Math.round(sub.getBoundingClientRect().top)
        ),
        scrolls: list.scrollWidth > list.clientWidth + 1
      }))
      expect(new Set(subs.tops).size, `${language}: Inbox sub-tabs wrap`).toBe(1)
      await expect(subList).toHaveAttribute('data-overflow-end', String(subs.scrolls))
      await subList.getByRole('tab').last().click()
      await expect
        .poll(() =>
          subList.evaluate((list) => {
            const last = [...list.querySelectorAll('[role="tab"]')].at(-1)
            return (
              (last?.getBoundingClientRect().right ?? Infinity) <=
              list.getBoundingClientRect().right + 0.5
            )
          })
        )
        .toBe(true)
      await subList.getByRole('tab').first().click()

      if (!CAPTURE_EVIDENCE) {
        continue
      }
      await orcaPage.mouse.move(0, 0)
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        for (const theme of ['dark', 'light'] as const) {
          await orcaPage.evaluate(async (next) => {
            const settings = await window.api.settings.set({ theme: next })
            window.__store?.setState({ settings })
          }, theme)
          await orcaPage.waitForTimeout(300)
          await orcaPage.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(`strip-fit-${language}-${width}-${theme}.png`)
          })
        }
      }
      await orcaPage.setViewportSize({ width: 1440, height: 900 })
    }
  } finally {
    agent.dispose()
  }
})
