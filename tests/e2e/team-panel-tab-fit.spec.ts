/**
 * Invariant: the panel tabs and the Inbox sub-tabs sit whole inside the panel, on one line and with no
 * scroll, at every sidebar and window width, as V28 does (ORCA-1142). Needs E2E: the cut depends on
 * the real font, the sidebar's clamp and the panel's container widths.
 */

import type { ElectronApplication, Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { setTheme, THEMES, WIDTHS } from './helpers/settings-window'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'

const CAPTURE = process.env.ORCA_E2E_CAPTURE === '1'
const soft = expect.configure({ soft: true })
const GB = 1024 ** 3
// Why 2000: the store clamps it to the widest the window allows.
const SIDEBARS = [220, 280, 2000] as const
const LANGUAGES = ['en', 'es'] as const
// Why 12 of each: two-digit counts are the widest strip a project shows.
const COUNT = 12

const at = (minute: number): string => new Date(Date.UTC(2026, 10, 7, 12, minute)).toISOString()
const OVERLAY: Record<string, Record<string, unknown>> = {
  'game.state': {
    project: {
      reviews: {
        provider: 'github',
        total: 1,
        url: 'https://github.com/o/r/pulls',
        items: [{ id: '#924', title: 'Fit the tabs', url: 'https://github.com/o/r/pull/924' }]
      },
      queue: {
        provider: 'github',
        entries: [
          {
            id: '#951',
            title: 'Fit the tabs',
            url: 'https://github.com/o/r/pull/951',
            position: 1,
            state: 'checks',
            since: Date.now()
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
        cpuCoreCount: 8,
        totalMemory: 16 * GB,
        availableMemory: 8 * GB,
        loadAverage1m: 1
      },
      { host: 'm1', running: 0, cap: 2, status: 'unreachable' }
    ]
  },
  'game.inboxThreads': {
    threads: Array.from({ length: COUNT }, (_, index) => ({
      ticket: `ORCA-${100 + index}`,
      last: at(index),
      waiting: 0,
      messages: []
    })),
    waiting: Array.from({ length: COUNT }, (_, index) => ({
      id: `w${index}`,
      ticket: `ORCA-${100 + index}`,
      kind: 'question',
      subject: 'Port?',
      body: 'Which port?',
      at: at(index),
      answerer: 'lead'
    })),
    answered: Array.from({ length: COUNT }, (_, index) => ({
      id: `a${index}`,
      ticket: `ORCA-${100 + index}`,
      kind: 'question',
      question: 'Port?',
      answer: '5173',
      askedAt: at(index),
      answeredAt: at(index + 1)
    }))
  },
  'game.ownerQuestions': {
    questions: Array.from({ length: COUNT }, (_, index) => ({
      id: `q${index}`,
      ticket: `ORCA-${100 + index}`,
      question: 'Merge it?',
      options: ['Yes', 'No'],
      context: null,
      askedAt: at(index),
      answer: null
    })),
    undelivered: []
  }
}

type RuntimeCall = (event: unknown, args: { method: string }) => Promise<{ result?: object }>

/** Lays the fixture over the real answers of the reads that fill the tabs and their counts. */
async function overlayPanelReads(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }, overlay) => {
    const { _invokeHandlers: handlers } = ipcMain as unknown as {
      _invokeHandlers: Map<string, RuntimeCall>
    }
    const real = handlers.get('runtime:call')!
    ipcMain.removeHandler('runtime:call')
    ipcMain.handle('runtime:call', async (event, args: { method: string }) => {
      const response = await real(event, args)
      const extra = overlay[args.method]
      return extra ? { ...response, result: { ...response.result, ...extra } } : response
    })
  }, OVERLAY)
}

// Why two frames: a check read right after a resize can still see the wider layout.
const settleLayout = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )

/** Every tab past the panel's or the strip's edge, and a strip that has to scroll. */
function cutTabsOf(strip: Locator): Promise<string[]> {
  return strip.evaluate((node) => {
    const panel = node.closest('[data-testid="team-panel"]')!.getBoundingClientRect()
    const box = node.getBoundingClientRect()
    const left = Math.max(box.left, panel.left)
    const right = Math.min(box.right, panel.right)
    const cut = [...node.querySelectorAll('[role="tab"]')]
      .filter((tab) => {
        const edge = tab.getBoundingClientRect()
        return edge.left < left - 0.5 || edge.right > right + 0.5
      })
      .map((tab) => `${tab.textContent} ends at ${Math.round(tab.getBoundingClientRect().right)}`)
    if (node.scrollWidth > node.clientWidth + 1) {
      cut.push(`strip scrolls: ${node.scrollWidth} > ${node.clientWidth}`)
    }
    return cut
  })
}

test('the panel tabs and Inbox sub-tabs fit whole at every sidebar and window width', async ({
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
    // Why: another feature's first-run hint would sit on the narrow captures.
    await expect(orcaPage.getByText('Workspace board moved to the bottom bar').first()).toBeHidden({
      timeout: 15_000
    })
    await overlayPanelReads(electronApp)
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    const tabs = panel.locator('[role="tablist"]').first()
    await expect(tabs.getByRole('tab')).toHaveCount(5, { timeout: 60_000 })
    await tabs.getByRole('tab', { name: /Inbox|Bandeja/ }).click()
    const subTabs = panel.getByTestId('team-panel-inbox').getByRole('tablist')
    await expect(subTabs.getByRole('tab', { name: /Answered/ })).toContainText(String(COUNT), {
      timeout: 60_000
    })
    await expect(subTabs.getByRole('tab', { name: /For you/ })).toContainText(String(COUNT))

    let cases = 0
    for (const language of LANGUAGES) {
      await orcaPage.evaluate(
        (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
        language
      )
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        for (const sidebar of SIDEBARS) {
          await orcaPage.evaluate(
            (next) => window.__store!.getState().setRightSidebarWidth(next),
            sidebar
          )
          for (const theme of THEMES) {
            await setTheme(orcaPage, theme)
            await settleLayout(orcaPage)
            const panelWidth = await panel.evaluate((node) => node.clientWidth)
            const label = `${language} window ${width} sidebar ${sidebar} (${panelWidth} px) ${theme}`
            // Why a poll: a level change lands a render after the resize that asked for it.
            await soft
              .poll(() => cutTabsOf(tabs), { message: `panel tabs cut: ${label}`, timeout: 3000 })
              .toEqual([])
            await soft
              .poll(() => cutTabsOf(subTabs), {
                message: `Inbox sub-tabs cut: ${label}`,
                timeout: 3000
              })
              .toEqual([])
            cases += 2
            if (CAPTURE && sidebar === 280) {
              await panel.screenshot({
                animations: 'disabled',
                path: testInfo.outputPath(`tabs-${language}-${width}-${theme}.png`)
              })
            }
          }
        }
      }
    }
    expect(cases).toBe(LANGUAGES.length * WIDTHS.length * SIDEBARS.length * THEMES.length * 2)

    // Wide again, the strips go back to the full labels.
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarWidth(2000))
    await settleLayout(orcaPage)
    await expect(tabs).toContainText('Máquinas')
    await expect(subTabs).toContainText('Respondidas')
  } finally {
    agent.dispose()
  }
})
