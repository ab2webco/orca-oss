/**
 * Invariant: the panel tabs and the Inbox sub-tabs sit whole inside the panel, on one line and with no
 * scroll, at every sidebar and window width, as V28 does (ORCA-1142). Needs E2E: the cut depends on
 * the real font, the sidebar's clamp and the panel's container widths.
 */

import type { ElectronApplication, Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { setTheme, THEMES, WIDTHS } from './helpers/settings-window'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'

const CAPTURE = process.env.ORCA_E2E_CAPTURE === '1'
const soft = expect.configure({ soft: true })
// Why 2000: the store clamps it to the widest the window allows.
const SIDEBARS = [220, 280, 2000] as const
const LANGUAGES = ['en', 'es'] as const
// Why 12 of each: two-digit counts are the widest strip a project shows.
const twelve = <T>(make: (index: number) => T): T[] => Array.from({ length: 12 }, (_, i) => make(i))
const at = (minute: number): string => new Date(Date.UTC(2026, 10, 7, 12, minute)).toISOString()
// Each row's fields past its id, ticket and time.
const MACHINE = {
  status: 'ok',
  cpuCoreCount: 8,
  loadAverage1m: 1,
  totalMemory: 2e10,
  availableMemory: 1e10
}
const WAIT = { kind: 'question', subject: 'Port?', body: 'Which?', answerer: 'lead' }
const ANSWER = { kind: 'question', question: 'Port?', answer: '5173' }
const ASK = { question: 'Merge it?', options: ['Yes', 'No'], context: null, answer: null }
const row = (prefix: string, i: number) => ({ id: `${prefix}${i}`, ticket: `ORCA-${100 + i}` })
const pull = { id: '#951', title: 'Fit the tabs', url: 'https://github.com/o/r/pull/951' }

const OVERLAY: Record<string, Record<string, unknown>> = {
  'game.state': {
    project: {
      reviews: { provider: 'github', total: 1, url: 'https://github.com/o/r/pulls', items: [pull] },
      queue: { provider: 'github', entries: [{ ...pull, position: 1, state: 'checks', since: 1 }] }
    },
    hostCapacity: [
      { host: 'local', running: 1, cap: 4, ...MACHINE },
      { host: 'm1', running: 0, cap: 2, status: 'unreachable' }
    ]
  },
  'game.inboxThreads': {
    threads: twelve((i) => ({ ticket: `ORCA-${100 + i}`, last: at(i), waiting: 0, messages: [] })),
    waiting: twelve((i) => ({ ...WAIT, ...row('w', i), at: at(i) })),
    answered: twelve((i) => ({ ...ANSWER, ...row('a', i), askedAt: at(i), answeredAt: at(i) }))
  },
  'game.ownerQuestions': {
    questions: twelve((i) => ({ ...ASK, ...row('q', i), askedAt: at(i) })),
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

/** Opens the Inbox and checks both strips in every language, window, sidebar width and theme. */
async function sweepStrips(page: Page, testInfo: TestInfo, look: 'team' | 'solo'): Promise<void> {
  const panel = page.getByTestId('team-panel')
  const tabs = panel.locator('[role="tablist"]').first()
  await expect(tabs.getByRole('tab')).toHaveCount(look === 'team' ? 4 : 3, { timeout: 60_000 })
  const inboxTab = tabs.getByRole('tab', { name: /Inbox|Bandeja/ })
  await inboxTab.click()
  await expect(inboxTab).toContainText('12', { timeout: 60_000 })
  const subTabs = panel.getByTestId('team-panel-inbox').getByRole('tablist')
  await expect(subTabs.getByRole('tab', { name: /For you/ })).toContainText('12')
  let cases = 0
  for (const language of LANGUAGES) {
    await page.evaluate(
      (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
      language
    )
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      for (const sidebar of SIDEBARS) {
        await page.evaluate(
          (next) => window.__store!.getState().setRightSidebarWidth(next),
          sidebar
        )
        for (const theme of THEMES) {
          await setTheme(page, theme)
          const panelWidth = await panel.evaluate((node) => node.clientWidth)
          const label = `${look} ${language} window ${width} sidebar ${sidebar} (${panelWidth} px) ${theme}`
          // Why a poll: a level change lands a render after the resize that asked for it.
          for (const [strip, name] of [
            [tabs, 'panel tabs'],
            [subTabs, 'Inbox sub-tabs']
          ] as const) {
            await soft
              .poll(() => cutTabsOf(strip), { message: `${name} cut: ${label}`, timeout: 3000 })
              .toEqual([])
            cases++
          }
          if (CAPTURE) {
            await panel.screenshot({
              animations: 'disabled',
              path: testInfo.outputPath(`${look}-${language}-${width}-${sidebar}-${theme}.png`)
            })
          }
        }
      }
    }
  }
  expect(cases).toBe(LANGUAGES.length * WIDTHS.length * SIDEBARS.length * THEMES.length * 2)
  // Wide again, the strips go back to the full labels.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => window.__store!.getState().setRightSidebarWidth(2000))
  await expect(tabs).toContainText('Máquinas')
  await expect(subTabs).toContainText('Respondidas')
}

async function openPanel(page: Page): Promise<string> {
  await waitForSessionReady(page)
  const worktreeId = await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
  await waitForActivePanePtyId(page)
  // Why: another feature's first-run hint would sit on the narrow captures.
  await expect(page.getByText('Workspace board moved to the bottom bar').first()).toBeHidden({
    timeout: 15_000
  })
  return worktreeId
}

test('the panel tabs and Inbox sub-tabs fit whole at every sidebar and window width', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(600_000)
  const agent = createStdinLoggingAgent()
  try {
    const worktreeId = await openPanel(orcaPage)
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
    await overlayPanelReads(electronApp)
    await orcaPage.evaluate(() => {
      window.__store!.getState().setRightSidebarOpen(true)
      window.__store!.getState().setRightSidebarTab('team')
    })
    await sweepStrips(orcaPage, testInfo, 'team')
  } finally {
    agent.dispose()
  }
})

// With no team the strip holds Activity, Inbox and Machines, whose full Spanish labels overflow 219 px.
test('the no-team panel tabs fit whole at every sidebar and window width', async ({
  orcaPage
}, testInfo) => {
  test.setTimeout(600_000)
  const worktreeId = await openPanel(orcaPage)
  const { paneKey } = await waitForActivePaneHookDescriptor(orcaPage)
  // Twelve agents asking, eleven of them on an SSH host so Machines shows.
  await orcaPage.evaluate(
    ({ paneKey, worktreeId }) => {
      const store = window.__store!
      const interactivePrompt = JSON.stringify({
        questions: [{ question: 'Merge it?', multiSelect: false, options: [{ label: 'Yes' }] }]
      })
      const asking = { state: 'blocked', prompt: 'Ship', agentType: 'claude', interactivePrompt }
      const template = Object.values(store.getState().worktreesByRepo)
        .flat()
        .find((one) => one.id === worktreeId)!
      store.setState({ sshTargetLabels: new Map([['box-id', 'box']]) })
      const ask = { ...asking, toolName: 'AskUserQuestion' } as never
      store.getState().setAgentStatus(paneKey, ask, 'here')
      for (let i = 0; i < 11; i++) {
        const { worktreesByRepo, tabsByWorktree } = store.getState()
        const id = `on-box-${i}`
        const tabId = `tab-box-${i}`
        store.setState({
          worktreesByRepo: {
            ...worktreesByRepo,
            [`e2e-${id}`]: [{ ...template, id, path: `/${id}`, hostId: 'ssh:box-id' }]
          },
          tabsByWorktree: {
            ...tabsByWorktree,
            [id]: [{ ...tabsByWorktree[worktreeId]![0]!, id: tabId }]
          }
        } as never)
        const key = `${tabId}:5555555${i % 10}-5555-4555-8555-55555555555${i % 10}`
        store.getState().setAgentStatus(key, ask, id)
      }
      store.getState().setRightSidebarOpen(true)
      store.getState().setRightSidebarTab('team')
    },
    { paneKey, worktreeId }
  )
  await sweepStrips(orcaPage, testInfo, 'solo')
})
