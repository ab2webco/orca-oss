import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { setTheme, THEMES, WIDTHS } from './helpers/settings-window'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import { writeSettings } from './helpers/settings-write'

const GB = 1024 ** 3
const HOUR_MS = 3_600_000
const LANGUAGES = ['en', 'es'] as const
// Why no queue: V30 draws the merge queue at the top of PRs.
const TABS = ['team', 'prs', 'machines'] as const
// Why: the full capture matrix outruns the CI test budget; ORCA_CAPTURE_EVIDENCE=1 runs it locally.
const CAPTURE_EVIDENCE = process.env.ORCA_CAPTURE_EVIDENCE === '1'
// Why 390 on the way: a jump from 1440 straight to 320 can leave the selected tab in view by chance.
const CHECK_WIDTHS = CAPTURE_EVIDENCE ? WIDTHS : ([1440, 390, 320] as const)
const CHECK_THEMES = CAPTURE_EVIDENCE ? THEMES : (['dark'] as const)

type Language = (typeof LANGUAGES)[number]
type Tab = (typeof TABS)[number]
type SceneName = 'full' | 'empty' | 'error' | 'limited' | 'unavailable'
/** What the panel's `game.state` reads get on top of the real answer. */
type Scene = { set: Record<string, unknown>; remove: string[] }

const COPY = {
  en: {
    tabs: { team: 'Team', prs: 'PRs', machines: 'Machines' },
    notRegistered: 'Not registered',
    refused: 'Refused',
    prsEmpty: 'You have no open PRs',
    prsError: 'Could not read pull requests',
    retryNow: 'Retry now',
    limitTitle: 'GitHub did not answer',
    queueTitle: 'Merge queue · 16',
    viewAll: 'View all 12',
    viewTasks: 'View tasks',
    sent: 'Sent to the lead: Review'
  },
  es: {
    tabs: { team: 'Equipo', prs: 'PRs', machines: 'Máquinas' },
    notRegistered: 'Sin registrar',
    refused: 'Rechazada',
    prsEmpty: 'No tienes PRs abiertos',
    prsError: 'No se pudieron leer los pull requests',
    retryNow: 'Reintentar ahora',
    limitTitle: 'GitHub no respondió',
    queueTitle: 'Cola de merge · 16',
    viewAll: 'Ver los 12',
    viewTasks: 'Ver tareas',
    sent: 'Enviado al líder: Review'
  }
} as const

// Why koombea: its orca-oss is a partial clone, which never gets a remote identity (ORCA-1250).
const KOOMBEA_REFUSAL =
  "orca-oss on koombea has no remote identity yet, so Orca cannot tell whether it is orca-oss's clone. See ORCA-1250."
const CONTABO_REFUSAL =
  "orca-oss on orca-contabo names github.com/stablyai/orca, the upstream every fork of it shares, so Orca cannot tell it is orca-oss's clone. If it is, list github.com/stablyai/orca in orchestratorGame.orchestrator.memberRepos."

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
        { host: 'imac', running: 0, cap: 2, status: 'unreachable' },
        // ORCA-1207: the QA's hosts that read "Free" though `game launch --on` refuses them.
        {
          host: 'mini',
          running: 0,
          cap: 4,
          ...machine(8, 32, 28, 1),
          launch: { kind: 'unregistered', project: 'orca-oss', reason: 'not on mini' }
        },
        {
          host: 'koombea',
          running: 0,
          cap: 4,
          ...machine(8, 32, 28, 1),
          launch: { kind: 'refused', reason: KOOMBEA_REFUSAL }
        },
        {
          host: 'orca-contabo',
          running: 0,
          cap: 4,
          ...machine(8, 32, 28, 1),
          launch: { kind: 'refused', reason: CONTABO_REFUSAL }
        }
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
  // Why GitHub's own budget: the one read that names the provider and says a retry cannot help yet.
  limited: {
    remove: ['hostCapacity'],
    set: {
      project: { reviews: null, todo: null },
      hosts: [],
      githubBudget: {
        graphql: { limit: 5000, remaining: 0, resetAt: Math.floor(now / 1000) + 720, orcaCalls: 0 },
        core: { limit: 5000, remaining: 4000, resetAt: Math.floor(now / 1000) + 720, orcaCalls: 0 },
        top: [],
        low: true
      }
    }
  },
  unavailable: { remove: ['project', 'hostCapacity', 'localHost', 'hosts', 'actions'], set: {} }
})

type RigGlobal = typeof globalThis & {
  __teamScene?: Scene
  /** game.state reads that asked for fresh lists (Retry now). */
  __teamFreshReads?: number
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
    ipcMain.handle('runtime:call', async (event, args: { method: string; params?: unknown }) => {
      if (args.method !== 'game.state') {
        return real(event, args)
      }
      if ((args.params as { fresh?: unknown } | undefined)?.fresh === true) {
        rig.__teamFreshReads = (rig.__teamFreshReads ?? 0) + 1
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
test('the PRs (with its merge queue) and Machines tabs, To Do and Actions draw every state and reach the lead', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  // Why longer to capture: evidence mode walks every width and theme, 8x the checked set.
  test.setTimeout(CAPTURE_EVIDENCE ? 2_400_000 : 900_000)
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
    // Why gated before the lead exists: a team the sidebar read first reopens instead of the loader (ORCA-1199).
    const all = scenes(Date.now())
    await wrapGameState(electronApp)
    await setScene(electronApp, all.full)
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

    // Why: waited before opening, whose gated read's 15 s timeout would end loading; another feature's first-run hint would sit on the first captures at narrow widths.
    await expect(orcaPage.getByText('Workspace board moved to the bottom bar').first()).toBeHidden({
      timeout: 15_000
    })

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

    const expectScene = async (name: SceneName, language: Language): Promise<void> => {
      const words = COPY[language]
      await panel.getByRole('tab', { name: words.tabs.prs }).click()
      if (name === 'full') {
        await expect(panel.locator('[data-team-pr="#924"]')).toBeVisible({ timeout: 30_000 })
        await expect(panel.locator('[data-team-pr="#924"]')).toHaveAttribute(
          'href',
          'https://github.com/o/r/pull/924'
        )
        await panel.getByRole('tab', { name: words.tabs.machines }).click()
        const mini = panel.locator('[data-team-machine="mini"]')
        await expect(mini).toContainText(words.notRegistered)
        await expect(mini.locator('[data-team-machine-launch="unregistered"]')).toBeVisible()
        await expect(
          panel.locator('[data-team-machine="koombea"] [data-team-machine-launch="refused"]')
        ).toHaveText(KOOMBEA_REFUSAL)
        const contabo = panel.locator('[data-team-machine="orca-contabo"]')
        await expect(contabo).toContainText(words.refused)
        await expect(contabo.locator('[data-team-machine-launch="refused"]')).toHaveText(
          CONTABO_REFUSAL
        )
        await panel.getByRole('tab', { name: words.tabs.prs }).click()
      } else if (name === 'empty') {
        await expect(panel).toContainText(words.prsEmpty, { timeout: 30_000 })
      } else if (name === 'limited') {
        await expect(panel).toContainText(words.limitTitle, { timeout: 30_000 })
        await expect(panel.getByRole('button', { name: words.retryNow })).toHaveCount(0)
      } else {
        await expect(panel).toContainText(words.prsError, { timeout: 30_000 })
        if (name === 'error') {
          await expect(panel.getByRole('button', { name: words.retryNow })).toBeVisible()
        }
      }
    }

    for (const language of LANGUAGES) {
      await writeSettings(orcaPage, { uiLanguage: language })
      for (const name of ['full', 'empty', 'error', 'limited', 'unavailable'] as const) {
        await setScene(electronApp, all[name])
        await rereadPanel(orcaPage)
        await orcaPage.setViewportSize({ width: 1440, height: 900 })
        await expect(panel.getByRole('tab', { name: COPY[language].tabs.prs })).toBeVisible({
          timeout: 30_000
        })
        await expectScene(name, language)
        await expect(panel.getByRole('tab', { name: /^(Queue|Cola)$/ })).toHaveCount(0)
        await panel.getByRole('tab', { name: COPY[language].tabs.prs }).click()
        const queueTitle = panel.locator('[data-team-queue-title]')
        await (name === 'full'
          ? expect(queueTitle).toHaveText(COPY[language].queueTitle)
          : expect(queueTitle).toHaveCount(0))
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

    // One Retry now reaches the host as one fresh read; the rig keeps the failure, as a host older
    // than the flag would, so the error stays and the button comes back for another try.
    await setScene(electronApp, all.error)
    await rereadPanel(orcaPage)
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await panel.getByRole('tab', { name: COPY.es.tabs.prs }).click()
    const retryNow = panel.getByRole('button', { name: COPY.es.retryNow })
    await expect(retryNow).toBeEnabled({ timeout: 30_000 })
    const freshBefore = await electronApp.evaluate(
      () => (globalThis as RigGlobal).__teamFreshReads ?? 0
    )
    await retryNow.click()
    await expect
      .poll(() => electronApp.evaluate(() => (globalThis as RigGlobal).__teamFreshReads ?? 0))
      .toBe(freshBefore + 1)
    await expect(retryNow).toBeEnabled({ timeout: 30_000 })
    await expect(panel).toContainText(COPY.es.prsError)

    await setScene(electronApp, all.full)
    await rereadPanel(orcaPage)

    // Narrow, the strip shortens its labels so the last tab sits whole; the keys and a sideways wheel reach it.
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
