import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { setTheme, THEMES, WIDTHS } from './helpers/settings-window'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'

const GB = 1024 ** 3
const HOUR_MS = 3_600_000
const LANGUAGES = ['en', 'es'] as const
const TABS = ['team', 'prs', 'queue', 'machines'] as const
// Why: the full capture matrix outruns the CI test budget; ORCA_CAPTURE_EVIDENCE=1 runs it locally.
const CAPTURE_EVIDENCE = process.env.ORCA_CAPTURE_EVIDENCE === '1'
// Why 390 on the way: a jump from 1440 straight to 320 can leave the selected tab in view by chance.
const CHECK_WIDTHS = CAPTURE_EVIDENCE ? WIDTHS : ([1440, 390, 320] as const)
const CHECK_THEMES = CAPTURE_EVIDENCE ? THEMES : (['dark'] as const)

type Language = (typeof LANGUAGES)[number]
type Tab = (typeof TABS)[number]
type SceneName = 'full' | 'empty' | 'error' | 'unavailable'
/** What the panel's `game.state` reads get on top of the real answer. */
type Scene = { set: Record<string, unknown>; remove: string[] }

const COPY = {
  en: {
    tabs: { team: 'Team', prs: 'PRs', queue: 'Queue', machines: 'Machines' },
    prsEmpty: 'No open pull requests',
    prsError: 'Could not read pull requests',
    queueNone: 'No merge queue to show',
    viewAll: 'View all 12',
    viewTasks: 'View tasks',
    sent: 'Sent to the lead: Review'
  },
  es: {
    tabs: { team: 'Equipo', prs: 'PRs', queue: 'Cola', machines: 'Máquinas' },
    prsEmpty: 'No hay pull requests abiertos',
    prsError: 'No se pudieron leer los pull requests',
    queueNone: 'No hay cola de merge que mostrar',
    viewAll: 'Ver los 12',
    viewTasks: 'Ver tareas',
    sent: 'Enviado al líder: Review'
  }
} as const

const pull = (number: number, title: string, over: Record<string, unknown>) => ({
  id: `#${number}`,
  title,
  url: `https://github.com/o/r/pull/${number}`,
  ...over
})

const machine = (cores: number, total: number, free: number, load: number) => ({
  status: 'ok',
  cpuCoreCount: cores,
  totalMemory: total * GB,
  availableMemory: free * GB,
  loadAverage1m: load
})

const NO_WORK = {
  reviews: { provider: 'github', total: 0, url: null, items: [] },
  todo: { provider: 'plane', total: 0, url: null, items: [] },
  queue: { provider: 'github', entries: [] }
}

const scenes = (now: number): Record<SceneName, Scene> => ({
  full: {
    remove: [],
    set: {
      project: {
        reviews: {
          provider: 'github',
          total: 12,
          url: 'https://github.com/o/r/pulls',
          actionId: 'action-0',
          items: [
            pull(924, 'Keep the reflow column when the panel is resized', { status: 'pending' }),
            pull(917, 'Release notes for the lab channel', { status: 'success' }),
            pull(915, 'Launch E2E waits for the first signal', { status: 'failure' }),
            pull(903, 'Move the worktree cache out of the store', {
              status: 'success',
              reviewBlock: 'conflict'
            }),
            pull(899, 'Draft of the arcade credit', { status: 'none', reviewBlock: 'draft' })
          ]
        },
        queue: {
          provider: 'github',
          entries: [
            {
              id: '#951',
              title: 'Launch E2E waits for the first signal',
              url: 'https://github.com/o/r/pull/951',
              position: 1,
              state: 'checks',
              since: now - 0.2 * HOUR_MS
            },
            {
              id: '#953',
              title: 'Panel rows in the project game section',
              url: 'https://github.com/o/r/pull/953',
              position: 2,
              state: 'waiting',
              since: now - 2.5 * HOUR_MS
            },
            {
              id: '#954',
              title: 'Open the Settings section from the gear',
              url: 'https://github.com/o/r/pull/954',
              position: 3,
              state: 'failed',
              since: now - 0.5 * HOUR_MS
            },
            // Why so many: the last row must reach the floating trigger's corner at 900 px tall.
            ...Array.from({ length: 13 }, (_, index) => ({
              id: `#${960 + index}`,
              title: `Queued pull request ${index + 1}`,
              url: `https://github.com/o/r/pull/${960 + index}`,
              position: 4 + index,
              state: 'waiting',
              since: now - (index + 1) * 0.1 * HOUR_MS
            }))
          ]
        }
      },
      actions: [{ id: 'action-0', label: 'Review', prompt: 'Review my open pull requests' }],
      hostCapacity: [
        { host: 'local', running: 2, cap: 4, ...machine(14, 36, 21.4, 3.2) },
        { host: 'm1', running: 1, cap: 2, ...machine(8, 16, 2.1, 5) },
        { host: 'imac', running: 0, cap: 2, status: 'unreachable' }
      ]
    }
  },
  empty: { remove: ['hostCapacity'], set: { project: NO_WORK, hosts: [] } },
  error: {
    remove: ['hostCapacity'],
    set: {
      project: { reviews: null, todo: null, queue: { provider: 'github', entries: null } },
      hosts: []
    }
  },
  unavailable: { remove: ['project', 'hostCapacity', 'hosts', 'actions'], set: {} }
})

type RigGlobal = typeof globalThis & {
  __teamScene?: Scene
  __teamGate?: Promise<void> | null
  __teamOpenGate?: () => void
}
type RuntimeCall = (event: unknown, args: { method: string }) => Promise<{ result?: object }>

/** Serves the panel's `game.state` through the real handler with the scene laid over its answer. */
async function wrapGameState(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    const rig = globalThis as RigGlobal
    rig.__teamGate = new Promise<void>((resolve) => {
      rig.__teamOpenGate = resolve
    })
    const { _invokeHandlers: handlers } = ipcMain as unknown as {
      _invokeHandlers: Map<string, RuntimeCall>
    }
    const real = handlers.get('runtime:call')!
    ipcMain.removeHandler('runtime:call')
    ipcMain.handle('runtime:call', async (event, args: { method: string }) => {
      if (args.method !== 'game.state') {
        return real(event, args)
      }
      await rig.__teamGate
      const response = await real(event, args)
      const { set = {}, remove = [] } = rig.__teamScene ?? {}
      const result: Record<string, unknown> = { ...response.result, ...set }
      remove.forEach((key) => delete result[key])
      return { ...response, result }
    })
  })
}

const setScene = (electronApp: ElectronApplication, scene: Scene): Promise<void> =>
  electronApp.evaluate((_, next) => {
    ;(globalThis as RigGlobal).__teamScene = next
  }, scene)

// Why through another tab: the panel re-reads on mount, far sooner than its 20 s poll.
async function rereadPanel(page: Page): Promise<void> {
  await page.evaluate(() => window.__store!.getState().setRightSidebarTab('explorer'))
  await page.evaluate(() => window.__store!.getState().setRightSidebarTab('team'))
}

async function expectNoSidewaysScroll(page: Page, label: string): Promise<void> {
  const overflow = await page
    .getByTestId('team-panel')
    .evaluate((node) => node.scrollWidth - node.clientWidth)
  expect(overflow, `panel overflows: ${label}`).toBeLessThanOrEqual(0)
}

// A soft check, so one run names every row and width the trigger covers.
async function expectNoRowUnderTrigger(page: Page, label: string): Promise<void> {
  const covered = await page.getByTestId('team-panel').evaluate((node) => {
    const trigger = document
      .querySelector('[data-floating-terminal-toggle]')!
      .getBoundingClientRect()
    return [...node.querySelectorAll('[role="tabpanel"] :is(a, button)')]
      .filter((row) => {
        const box = row.getBoundingClientRect()
        return (
          box.left < trigger.right &&
          box.right > trigger.left &&
          box.top < trigger.bottom &&
          box.bottom > trigger.top
        )
      })
      .map((row) => row.textContent)
  })
  expect.soft(covered, `under the floating trigger: ${label}`).toEqual([])
}

async function expectTabInsideStrip(page: Page, name: string): Promise<void> {
  const panel = page.getByTestId('team-panel')
  await expect
    .poll(async () => {
      const strip = (await panel.getByRole('tablist').boundingBox())!
      const tab = (await panel.getByRole('tab', { name }).boundingBox())!
      return tab.x >= strip.x && tab.x + tab.width <= strip.x + strip.width
    }, `${name} sits inside the tab strip`)
    .toBe(true)
}

// Why two frames: a check read right after a resize can still see the wider layout.
const settleLayout = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )

async function expectActiveTabInsideStrip(page: Page, label: string): Promise<void> {
  const clipped = await page.getByTestId('team-panel').evaluate((node) => {
    const strip = node.querySelector('[role="tablist"]')!.getBoundingClientRect()
    const tab = node.querySelector('[role="tab"][aria-selected="true"]')!.getBoundingClientRect()
    return tab.left < strip.left || tab.right > strip.right
  })
  expect.soft(clipped, `selected tab clipped by the strip: ${label}`).toBe(false)
}

async function scrollTabToEnd(page: Page): Promise<void> {
  await page
    .getByTestId('team-panel')
    .locator('[role="tabpanel"]')
    .evaluate((node) => {
      node.scrollTop = node.scrollHeight
    })
}

// The tabs read a real lead's `game.state` with provider data laid over it: nothing is seeded into
// the panel's own model, and a press has to reach the lead pane's process.
test('the PRs, Queue and Machines tabs, To Do and Actions draw every state and reach the lead', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(900_000)
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

    // Why: waited before the gated read, whose 15 s timeout would end loading; another feature's first-run hint would sit on the first captures at narrow widths.
    await expect(orcaPage.getByText('Workspace board moved to the bottom bar').first()).toBeHidden({
      timeout: 15_000
    })

    const all = scenes(Date.now())
    await wrapGameState(electronApp)
    await setScene(electronApp, all.full)
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')

    // Loading holds the read; it has no words, so one language says all of it.
    await expect(panel.locator('[aria-busy="true"]')).toBeVisible({ timeout: 30_000 })
    for (const width of CHECK_WIDTHS) {
      await orcaPage.setViewportSize({ width, height: 900 })
      for (const theme of CHECK_THEMES) {
        await setTheme(orcaPage, theme)
        // Why: a fresh read per capture keeps each one inside the panel's 15 s request timeout.
        await rereadPanel(orcaPage)
        await expect(panel.locator('[aria-busy="true"]')).toBeVisible()
        if (CAPTURE_EVIDENCE) {
          await panel.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(`loading-${width}-${theme}.png`)
          })
        }
      }
    }
    await electronApp.evaluate(() => (globalThis as RigGlobal).__teamOpenGate?.())

    // TEMPORARY ORCA-1120 probe: what the live scene costs this runner's renderer. Removed before merge.
    {
      const probe = async (look: string): Promise<string> => {
        await orcaPage.evaluate(
          (next) =>
            window.__store!.getState().updateSettings({
              orchestratorGame: { panel: { look: next } }
            } as never),
          look
        )
        await expect(panel.locator('[data-team-scene]')).toHaveCount(look === 'game' ? 1 : 0, {
          timeout: 30_000
        })
        await orcaPage.waitForTimeout(2000)
        const fps = await orcaPage.evaluate(
          () =>
            new Promise<number>((resolve) => {
              let frames = 0
              const start = performance.now()
              const tick = (now: number): void => {
                frames += 1
                if (now - start < 3000) {
                  requestAnimationFrame(tick)
                } else {
                  resolve(frames / 3)
                }
              }
              requestAnimationFrame(tick)
            })
        )
        let started = Date.now()
        for (let i = 0; i < 20; i++) {
          await orcaPage.evaluate(() => document.title)
        }
        const roundTrip = (Date.now() - started) / 20
        started = Date.now()
        await setTheme(orcaPage, 'dark')
        await settleLayout(orcaPage)
        await expectNoSidewaysScroll(orcaPage, 'probe')
        const check = Date.now() - started
        return `${look}: ${fps.toFixed(1)} frames/s, ${roundTrip.toFixed(0)} ms per evaluate, ${check} ms per check`
      }
      await orcaPage.setViewportSize({ width: 1440, height: 900 })
      await expect(panel.locator('[data-team-scene] canvas')).toBeVisible({ timeout: 30_000 })
      for (const look of ['game', 'plain', 'game']) {
        const description = await probe(look)
        console.log(`[ORCA-1120 probe] ${description}`)
        testInfo.annotations.push({ type: 'orca-1120-probe', description })
      }
    }

    const expectScene = async (name: SceneName, language: Language): Promise<void> => {
      const words = COPY[language]
      await panel.getByRole('tab', { name: words.tabs.prs }).click()
      if (name === 'full') {
        await expect(panel.locator('[data-team-pr="#924"]')).toBeVisible({ timeout: 30_000 })
        await expect(panel.locator('[data-team-pr="#924"]')).toHaveAttribute(
          'href',
          'https://github.com/o/r/pull/924'
        )
      } else if (name === 'empty') {
        await expect(panel).toContainText(words.prsEmpty, { timeout: 30_000 })
      } else {
        await expect(panel).toContainText(words.prsError, { timeout: 30_000 })
      }
    }

    for (const language of LANGUAGES) {
      await orcaPage.evaluate(
        (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
        language
      )
      for (const name of ['full', 'empty', 'error', 'unavailable'] as const) {
        await setScene(electronApp, all[name])
        await rereadPanel(orcaPage)
        await orcaPage.setViewportSize({ width: 1440, height: 900 })
        await expect(panel.getByRole('tab', { name: COPY[language].tabs.prs })).toBeVisible({
          timeout: 30_000
        })
        await expectScene(name, language)
        if (name === 'unavailable') {
          await panel.getByRole('tab', { name: COPY[language].tabs.queue }).click()
          await expect(panel).toContainText(COPY[language].queueNone)
        }
        for (const tab of TABS satisfies readonly Tab[]) {
          await panel.getByRole('tab', { name: COPY[language].tabs[tab] }).click()
          // Why: the pointer stays on the tab it pressed, and draws another tab's hover once narrow.
          await orcaPage.mouse.move(0, 0)
          // Why: a focused tab is sometimes kept in view by the browser, which hid a missing reveal.
          await orcaPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
          for (const width of CHECK_WIDTHS) {
            await orcaPage.setViewportSize({ width, height: 900 })
            for (const theme of CHECK_THEMES) {
              await setTheme(orcaPage, theme)
              await scrollTabToEnd(orcaPage)
              await settleLayout(orcaPage)
              const label = `${name} ${tab} ${width} ${theme} ${language}`
              await expectNoSidewaysScroll(orcaPage, label)
              await expectNoRowUnderTrigger(orcaPage, label)
              await expectActiveTabInsideStrip(orcaPage, label)
              if (!CAPTURE_EVIDENCE) {
                continue
              }
              if (name === 'full') {
                await orcaPage.screenshot({
                  animations: 'disabled',
                  path: testInfo.outputPath(`window-${tab}-${language}-${width}-${theme}.png`)
                })
              }
              await panel.screenshot({
                animations: 'disabled',
                path: testInfo.outputPath(`${name}-${tab}-${language}-${width}-${theme}.png`)
              })
            }
          }
        }
      }
    }

    await setScene(electronApp, all.full)
    await rereadPanel(orcaPage)

    // Narrow, the last tab is off the strip, as in V28: the keys and a sideways wheel must reach it.
    await orcaPage.setViewportSize({ width: 320, height: 900 })
    const firstTab = panel.getByRole('tab', { name: COPY.es.tabs.team })
    const lastTab = panel.getByRole('tab', { name: COPY.es.tabs.machines })
    await firstTab.click()
    await firstTab.press('ArrowLeft')
    await expect(lastTab).toHaveAttribute('aria-selected', 'true')
    await expectTabInsideStrip(orcaPage, COPY.es.tabs.machines)
    await firstTab.click()
    await panel.getByRole('tablist').hover()
    await orcaPage.mouse.wheel(300, 0)
    await expectTabInsideStrip(orcaPage, COPY.es.tabs.machines)

    // A press has to reach the process in the lead pane, not only the terminal's echo.
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await panel.getByRole('tab', { name: COPY.es.tabs.prs }).click()
    const viewAll = panel.getByRole('button', { name: COPY.es.viewAll })
    await expect(viewAll).toBeVisible({ timeout: 30_000 })
    await viewAll.click()
    await expect(orcaPage.getByText(COPY.es.sent).first()).toBeVisible()
    await expect.poll(() => agent.readStdin()).toContain('Review my open pull requests')

    // V28's only Tasks surface: the Team tab's empty state opens Orca's Tasks view.
    await setScene(electronApp, all.empty)
    await rereadPanel(orcaPage)
    await panel.getByRole('tab', { name: COPY.es.tabs.team }).click()
    if (CAPTURE_EVIDENCE) {
      await orcaPage.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('empty-team-window.png')
      })
    }
    await panel.getByRole('button', { name: COPY.es.viewTasks }).click()
    await expect
      .poll(() => orcaPage.evaluate(() => window.__store!.getState().activeView))
      .toBe('tasks')
  } finally {
    agent.dispose()
  }
})
