import type { ElectronApplication, Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { setTheme, THEMES, WIDTHS } from './helpers/settings-window'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import { writeSettings } from './helpers/settings-write'

const GB = 1024 ** 3
const LANGUAGES = ['en', 'es'] as const
// Why: the full capture matrix outruns the CI test budget; ORCA_CAPTURE_EVIDENCE=1 runs it locally.
const CAPTURE_EVIDENCE = process.env.ORCA_CAPTURE_EVIDENCE === '1'
const CHECK_WIDTHS = CAPTURE_EVIDENCE ? WIDTHS : ([1440, 320] as const)
const CHECK_THEMES = CAPTURE_EVIDENCE ? THEMES : (['dark'] as const)
// Why tall: the board must be captured whole, not cut at the panel's fold.
const CAPTURE_HEIGHT = 2200

const COPY = {
  en: { tab: 'Machines', team: 'Team', busy: 'Busy', unknown: 'Unknown' },
  es: {
    tab: 'Máquinas',
    team: 'Equipo',
    busy: 'Ocupada',
    unknown: 'Desconocida'
  }
} as const

const reading = (
  cores: number,
  totalGb: number,
  freeGb: number,
  load: number,
  cpu: number,
  diskGb: [number, number]
) => ({
  status: 'ok',
  cpuCoreCount: cores,
  totalMemory: totalGb * GB,
  availableMemory: freeGb * GB,
  loadAverage1m: load,
  cpuUsagePercent: cpu,
  workspaceDiskTotal: diskGb[0] * GB,
  workspaceDiskFree: diskGb[1] * GB
})

const READY = { launch: { kind: 'ready' } }

// Made-up hosts only: no capture may carry a real machine, user or address.
const HOSTS = [
  {
    host: 'local',
    running: 2,
    cap: 4,
    ...reading(12, 32, 18, 3.1, 38, [512, 210])
  },
  {
    host: 'studio',
    running: 1,
    cap: 4,
    ...READY,
    ...reading(10, 64, 51, 1.2, 12, [1000, 640])
  },
  {
    host: 'buildbox',
    running: 2,
    cap: 3,
    ...READY,
    ...reading(8, 16, 1.2, 9.4, 96, [460, 140])
  },
  {
    host: 'atelier',
    running: 0,
    cap: 4,
    ...reading(8, 32, 20, 0.4, 7, [500, 320]),
    launch: { kind: 'unregistered', project: 'e2e', reason: 'not on atelier' }
  },
  // An Orca older than ORCA-1252: memory and load, no CPU use or disk, no launch state.
  {
    host: 'veteran',
    running: 0,
    cap: 2,
    status: 'ok',
    cpuCoreCount: 4,
    totalMemory: 8 * GB,
    availableMemory: 5 * GB,
    loadAverage1m: 0.6
  },
  {
    host: 'nas-02',
    running: 0,
    cap: 2,
    status: 'unreachable',
    launch: { kind: 'unanswered' }
  }
]

type RigGlobal = typeof globalThis & { __machinesBoard?: unknown[] }
type RuntimeCall = (event: unknown, args: { method: string }) => Promise<{ result?: object }>

/** Serves the panel's `game.state` through the real handler with the made-up hosts laid over it. */
async function seedHosts(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }, hosts) => {
    ;(globalThis as RigGlobal).__machinesBoard = hosts
    const { _invokeHandlers: handlers } = ipcMain as unknown as {
      _invokeHandlers: Map<string, RuntimeCall>
    }
    const real = handlers.get('runtime:call')!
    ipcMain.removeHandler('runtime:call')
    ipcMain.handle('runtime:call', async (event, args: { method: string }) => {
      const response = await real(event, args)
      if (args.method !== 'game.state') {
        return response
      }
      const hostCapacity = (globalThis as RigGlobal).__machinesBoard
      return { ...response, result: { ...response.result, hostCapacity } }
    })
  }, HOSTS)
}

// Why through another tab: the panel re-reads on mount, far sooner than its 20 s poll.
async function rereadPanel(page: Page): Promise<void> {
  await page.evaluate(() => window.__store!.getState().setRightSidebarTab('explorer'))
  await page.evaluate(() => window.__store!.getState().setRightSidebarTab('team'))
}

// Why two frames: a check read right after a resize can still see the wider layout.
const settleLayout = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )

/** A registered lead with the made-up hosts, and the Team panel open in the right sidebar. */
async function openTeamPanel(
  electronApp: ElectronApplication,
  orcaPage: Page,
  agentCommand: string
): Promise<Locator> {
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
  await client.call('terminal.send', {
    terminal: lead,
    text: agentCommand,
    enter: true
  })
  await seedHosts(electronApp)
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
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('team')
  })
  return orcaPage.getByTestId('team-panel')
}

test('the Machines board draws each host collapsed with its CPU, memory and disk, opens a busy one, and keeps a choice (ORCA-1252)', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(CAPTURE_EVIDENCE ? 1_200_000 : 600_000)
  const agent = createStdinLoggingAgent()
  try {
    const panel = await openTeamPanel(electronApp, orcaPage, agent.command)
    const row = (name: string) => panel.locator(`[data-team-machine="${name}"]`)

    for (const language of LANGUAGES) {
      const words = COPY[language]
      await writeSettings(orcaPage, { uiLanguage: language })
      await orcaPage.setViewportSize({ width: 1440, height: CAPTURE_HEIGHT })
      await rereadPanel(orcaPage)
      await panel.getByRole('tab', { name: words.tab }).click({ timeout: 30_000 })
      await expect(row('buildbox')).toBeVisible({ timeout: 30_000 })

      await expect(row('studio')).toHaveAttribute('data-state', 'closed')
      await expect(row('studio').locator('[data-team-machine-gauge="cpu"]')).toHaveText('CPU12%')
      await expect(row('buildbox'), 'a busy host starts open').toHaveAttribute('data-state', 'open')
      await expect(row('buildbox')).toContainText(words.busy)
      await expect(row('buildbox').locator('[data-team-machine-readout="cpu"]')).toContainText(
        '96%'
      )
      // An older host's missing figures read unknown, never 0.
      await expect(row('veteran').locator('[data-team-machine-gauge="cpu"]')).toContainText('—')
      await expect(row('veteran').locator('[data-team-machine-gauge="disk"]')).toContainText('—')
      await expect(row('veteran')).not.toContainText('0%')
      await expect(row('veteran')).toContainText(words.unknown)

      // The strip: 3 of 6 ready (atelier unregistered, veteran unknown, nas-02 offline), 5 of 17 agents.
      const figure = (name: string) =>
        panel.locator(`[data-team-machines-summary] [data-team-machines-figure="${name}"]`)
      await expect(figure('ready')).toContainText(/3 (of|de) 6/)
      await expect(figure('agents')).toContainText(/5 (of|de) 17/)
      await expect(figure('agents')).toContainText(/6 (slots free|lugares libres)/)
      await expect(figure('warned')).toHaveText(/1.*buildbox$/)

      await panel.getByRole('tab', { name: words.tab }).click()
      await orcaPage.mouse.move(0, 0)
      for (const width of CHECK_WIDTHS) {
        await orcaPage.setViewportSize({ width, height: CAPTURE_HEIGHT })
        for (const theme of CHECK_THEMES) {
          await setTheme(orcaPage, theme)
          await settleLayout(orcaPage)
          const label = `machines ${width} ${theme} ${language}`
          const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth)
          expect(overflow, `panel overflows: ${label}`).toBeLessThanOrEqual(0)
          // Why: a long status once squeezed a host's name to nothing, with no sideways scroll.
          const cutNames = await panel
            .locator('[data-team-machine-name]')
            .evaluateAll((names) =>
              names.filter((one) => one.scrollWidth > one.clientWidth).map((one) => one.textContent)
            )
          expect.soft(cutNames, `host names cut: ${label}`).toEqual([])
          // Why: the status and the launch note say what to do; an ellipsis hid them at 320 and 390.
          const cutSentences = await panel
            .locator('[data-team-machine-status], [data-team-machine-launch]')
            .evaluateAll((lines) =>
              lines
                .filter((line) =>
                  [line, ...line.querySelectorAll('*')].some(
                    (one) =>
                      one.scrollWidth > one.clientWidth + 1 ||
                      one.scrollHeight > one.clientHeight + 1
                  )
                )
                .map((one) => one.textContent)
            )
          expect.soft(cutSentences, `status or note cut: ${label}`).toEqual([])
          // Why: an open card's bars once shrank to no width beside its big readouts.
          const flatBars = await panel
            .locator(
              '[data-team-machine-gauge] [role="img"], [data-team-machine-readout] [role="img"]'
            )
            .evaluateAll((bars) =>
              bars
                .filter((bar) => bar.getBoundingClientRect().width < 8)
                .map((bar) => bar.getAttribute('aria-label'))
            )
          expect.soft(flatBars, `bars with no width: ${label}`).toEqual([])
          // Why: a long label once ran past its strip tile and was clipped, in Spanish at 1440.
          const spilled = await panel
            .locator('[data-team-machines-figure]')
            .evaluateAll((figures) =>
              figures
                .filter((one) => one.scrollWidth > one.clientWidth)
                .map((one) => one.getAttribute('data-team-machines-figure'))
            )
          expect.soft(spilled, `strip figures spill: ${label}`).toEqual([])
          if (CAPTURE_EVIDENCE) {
            await panel.screenshot({
              animations: 'disabled',
              path: testInfo.outputPath(`machines-${language}-${width}-${theme}.png`)
            })
          }
        }
      }
    }

    // The user's open or closed choice outlives a tab switch while the panel stays open.
    await orcaPage.setViewportSize({ width: 1440, height: CAPTURE_HEIGHT })
    await row('studio').getByRole('button').first().click()
    await row('buildbox').getByRole('button').first().click()
    await panel.getByRole('tab', { name: COPY.es.team }).click()
    await panel.getByRole('tab', { name: COPY.es.tab }).click()
    await expect(row('studio')).toHaveAttribute('data-state', 'open')
    await expect(row('buildbox')).toHaveAttribute('data-state', 'closed')
    await expect(row('studio').locator('[data-team-machine-readout="disk"]')).toContainText('%')
    if (CAPTURE_EVIDENCE) {
      await setTheme(orcaPage, 'dark')
      await panel.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('machines-es-1440-dark-studio-open.png')
      })
    }
  } finally {
    agent.dispose()
  }
})

/** Where a strip tile draws its number over its label, lets text leave the tile, or splits "N of M". */
function stripFaults(strip: HTMLElement): string[] {
  const textBox = (node: Element): DOMRect => {
    const range = document.createRange()
    range.selectNodeContents(node)
    return range.getBoundingClientRect()
  }
  const meets = (a: DOMRect, b: DOMRect): boolean =>
    a.left < b.right - 0.5 &&
    b.left < a.right - 0.5 &&
    a.top < b.bottom - 0.5 &&
    b.top < a.bottom - 0.5
  const faults: string[] = []
  for (const tile of strip.querySelectorAll<HTMLElement>('[data-team-machines-figure]')) {
    const box = tile.getBoundingClientRect()
    const name = `${tile.dataset.teamMachinesFigure} (${getComputedStyle(tile).display}, ${Math.round(box.width)}px)`
    const label = tile.querySelector('[data-team-machines-label]')!
    const value = tile.querySelector('[data-team-machines-value]')!
    if (meets(textBox(label), textBox(value))) {
      faults.push(`${name}: number over its label`)
    }
    for (const part of [label, value, ...tile.querySelectorAll('[data-team-machines-lines]')]) {
      const text = textBox(part)
      if (text.left < box.left - 0.5 || text.right > box.right + 0.5) {
        faults.push(`${name}: "${part.textContent}" leaves the tile`)
      }
    }
    const total = value.querySelector('small')
    if (total && total.getClientRects().length > 1) {
      faults.push(`${name}: "${total.textContent}" split over lines`)
    }
  }
  return faults
}

test('the summary strip keeps each number clear of its label at every sidebar width (ORCA-1316)', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(600_000)
  const agent = createStdinLoggingAgent()
  try {
    const panel = await openTeamPanel(electronApp, orcaPage, agent.command)
    const strip = panel.locator('[data-team-machines-summary]')
    // Why a wide window: the sidebar is clamped to the room the window leaves it.
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    const defaultWidth = await orcaPage.evaluate(() => window.__store!.getState().rightSidebarWidth)
    const setWidth = async (width: number): Promise<void> => {
      await orcaPage.evaluate((w) => window.__store!.getState().setRightSidebarWidth(w), width)
      await settleLayout(orcaPage)
    }
    for (const language of LANGUAGES) {
      await writeSettings(orcaPage, { uiLanguage: language })
      await rereadPanel(orcaPage)
      await panel.getByRole('tab', { name: COPY[language].tab }).click({ timeout: 30_000 })
      await expect(strip).toBeVisible({ timeout: 30_000 })
      const faults: string[] = []
      for (let width = 219; width <= 600; width++) {
        await setWidth(width)
        const panelWidth = Math.round((await panel.boundingBox())!.width)
        faults.push(...(await strip.evaluate(stripFaults)).map((one) => `${panelWidth}: ${one}`))
      }
      expect.soft(faults, `strip faults in ${language}`).toEqual([])
      if (CAPTURE_EVIDENCE) {
        await orcaPage.mouse.move(0, 0)
        for (const [width, name] of [
          [defaultWidth, `default-${defaultWidth}`],
          ...[219, 260, 317, 320, 340, 350, 600].map((one) => [one, String(one)] as const)
        ] as const) {
          await setWidth(width)
          for (const theme of THEMES) {
            await setTheme(orcaPage, theme)
            await settleLayout(orcaPage)
            await panel.screenshot({
              animations: 'disabled',
              path: testInfo.outputPath(`strip-${language}-${name}-${theme}.png`)
            })
          }
        }
      }
    }
    await setWidth(defaultWidth)
  } finally {
    agent.dispose()
  }
})
