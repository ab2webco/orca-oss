import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

const WIDTHS = [1440, 768, 390, 320]
const COPY = {
  en: {
    team: 'Team',
    inbox: 'Inbox',
    answer: 'Answer in Inbox',
    lead: 'Lead',
    waiting: 'Waiting for your answer',
    open: 'Open terminal',
    awaited: 'Waiting for you',
    noTeam: 'Your work',
    readError: 'Could not read the team',
    readErrorText: 'Orca is not responding in this project. Try again.',
    retry: 'Try again'
  },
  es: {
    team: 'Equipo',
    inbox: 'Bandeja',
    answer: 'Responder en Bandeja',
    lead: 'Líder',
    waiting: 'Esperando tu respuesta',
    open: 'Abrir terminal',
    awaited: 'Te espera',
    noTeam: 'Tu trabajo',
    readError: 'No se pudo leer el equipo',
    readErrorText: 'Orca no responde en este proyecto. Vuelve a intentarlo.',
    retry: 'Reintentar'
  }
} as const

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

type RuntimeCall = (event: unknown, args: { method: string }) => Promise<unknown>
type ReadRig = typeof globalThis & { __teamReadFails?: boolean; __teamReads?: number }

/** Fails the panel's game.state as a host that stopped answering does; the CLI client is untouched. */
async function wrapPanelReads(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const rig = globalThis as ReadRig
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, RuntimeCall> })
      ._invokeHandlers
    const real = handlers.get('runtime:call')!
    ipcMain.removeHandler('runtime:call')
    ipcMain.handle('runtime:call', async (event, args: { method: string }) => {
      if (args.method === 'game.state') {
        rig.__teamReads = (rig.__teamReads ?? 0) + 1
      }
      if (args.method === 'game.state' && rig.__teamReadFails) {
        throw new Error('host did not answer')
      }
      return real(event, args)
    })
  })
}

const failPanelReads = (app: ElectronApplication, fails: boolean): Promise<void> =>
  app.evaluate((_, next) => {
    ;(globalThis as ReadRig).__teamReadFails = next
  }, fails)

/** How many game.state reads the panel has made, failed or not. */
const panelReads = (app: ElectronApplication): Promise<number> =>
  app.evaluate(() => (globalThis as ReadRig).__teamReads ?? 0)

/** Every language, width and theme, after checking the screen means what the name says. */
async function captureEvery(
  page: Page,
  outputPath: (name: string) => string,
  name: string,
  check: (language: 'en' | 'es') => Promise<void>
): Promise<void> {
  const panel = page.getByTestId('team-panel')
  for (const language of ['en', 'es'] as const) {
    await page.evaluate(
      (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
      language
    )
    await check(language)
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(page, theme)
        // A card wider than the panel is cut, and the person cannot read the member's line.
        const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth)
        expect(overflow, `panel overflows at ${width}px ${theme} ${language}`).toBeLessThanOrEqual(
          0
        )
        await page.screenshot({
          animations: 'disabled',
          path: outputPath(`${name}-${language}-${width}-${theme}.png`)
        })
      }
    }
  }
  await page.evaluate(() => window.__store!.getState().updateSettings({ uiLanguage: 'en' }))
  await page.setViewportSize({ width: 1440, height: 900 })
}

// The Team tab draws the lead and members the runtime itself reports; nothing is seeded into the
// panel (ORCA-1050). A real lead pane, real orchestration members and a real owner question.
test('the Team tab shows the live lead and its members from the lead game state', async ({
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
    await orcaPage.evaluate(async (command) => {
      await window.__store?.getState().updateSettings({
        uiLanguage: 'en',
        defaultTuiAgent: 'codex',
        agentCmdOverrides: { codex: command },
        agentDefaultArgs: { codex: '' }
      })
    }, agent.command)

    // Why a foreground process: a lead pane back at its shell is not a live lead.
    await client.call('terminal.send', {
      terminal: lead,
      text: 'node -e "setInterval(() => {}, 1e9)"',
      enter: true
    })
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

    const endpoint = await readHookEndpoint(electronApp)
    // The lead's agent row is posted the way Orca's hooks do; main attaches its terminal handle.
    await emitCodexHookStatus(endpoint, {
      paneKey: pane.paneKey,
      worktreeId,
      state: 'working',
      prompt: 'Lead the team'
    })

    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Team tab',
      from: lead
    })
    const member = async (ticket: string) => {
      const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
        spec: `Work on ${ticket}`,
        taskTitle: ticket,
        run: run.result.run.id,
        callerTerminalHandle: lead
      })
      const started = await client.call<{
        effects: { kind: string; role?: string; id?: string }[]
      }>('orchestration.workerStart', {
        task: task.result.task.id,
        from: lead,
        worktree: `id:${worktreeId}`,
        displayName: ticket,
        agent: 'codex',
        timeoutMs: 20_000
      })
      const handle = started.result.effects.find(
        (effect) => effect.kind === 'terminal' && effect.role === 'agent'
      )?.id
      expect(handle, `workerStart opened no agent terminal for ${ticket}`).toBeTruthy()
      const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
      const terminal = listed.result.terminals.find((one) => one.handle === handle)
      expect(terminal, `the ${ticket} terminal is not listed`).toBeTruthy()
      return {
        paneKey: `${terminal!.tabId}:${terminal!.leafId}`,
        worktreeId: terminal!.worktreeId
      }
    }
    const members = [await member('ORCA-12'), await member('ORCA-14')]
    const postMemberHooks = async (): Promise<void> => {
      for (const one of members) {
        await emitCodexHookStatus(endpoint, { ...one, state: 'working', prompt: 'Work' })
      }
    }
    await client.call('game.ownerAsk', {
      worktreeId,
      terminalHandle: lead,
      ticket: 'ORCA-14',
      question: 'Merge #14 now?',
      options: ['Yes', 'No']
    })

    // The runtime itself must report both members before the panel is judged.
    await expect
      .poll(
        async () => {
          await postMemberHooks()
          const state = (
            await client.call<OrchestratorGameState>('game.state', {
              worktreeId,
              terminalHandle: lead,
              paneKey: pane.paneKey
            })
          ).result
          return state.agents.filter((one) => one.isMember && !one.isLeader).length
        },
        { timeout: 90_000, message: 'game.state never listed the two members' }
      )
      .toBe(2)

    // A live lead whose game.state fails: the team's error, never the user's own sessions.
    await wrapPanelReads(electronApp)
    await failPanelReads(electronApp, true)
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    const cards = panel.locator('[data-team-card="member"]')
    const readError = async (language: 'en' | 'es'): Promise<void> => {
      await expect(panel).toContainText(COPY[language].readError, { timeout: 60_000 })
      await expect(panel).toContainText(COPY[language].readErrorText)
      await expect(panel.getByRole('button', { name: COPY[language].retry })).toBeVisible()
      await expect(panel).not.toContainText('runtime:call')
      await expect(panel).not.toContainText(COPY[language].noTeam)
    }
    await captureEvery(orcaPage, testInfo.outputPath.bind(testInfo), 'read-error-first', readError)
    // Why Retry while reads still fail: the panel also re-reads on its 20 s poll and on main's change
    // events, so once reads succeed it recovers on its own; the read within a second is Retry's (ORCA-1184).
    const readsBefore = await panelReads(electronApp)
    await panel.getByRole('button', { name: COPY.en.retry }).click()
    await expect
      .poll(() => panelReads(electronApp), {
        timeout: 1_000,
        message: 'Retry made no game.state read'
      })
      .toBe(readsBefore + 1)
    await expect(panel).toContainText(COPY.en.readError)
    await failPanelReads(electronApp, false)

    await expect(panel.locator('[data-team-card="lead"]')).toContainText(COPY.en.lead, {
      timeout: 90_000
    })
    await expect(cards).toHaveCount(2, { timeout: 60_000 })
    await expect(cards.filter({ hasText: 'ORCA-12' })).toHaveCount(1)
    await expect(cards.filter({ hasText: 'ORCA-14' })).toHaveCount(1)
    await expect(panel.getByRole('tab', { name: /Inbox/ })).toContainText('1')

    await captureEvery(
      orcaPage,
      testInfo.outputPath.bind(testInfo),
      'team-tab',
      async (language) => {
        await expect(panel.getByRole('tab', { name: COPY[language].team })).toBeVisible()
        // The red tone says ORCA-14 needs the user, so its line must say so too, and name it once.
        const asking = cards.filter({ hasText: 'ORCA-14' })
        await expect(asking).toContainText(COPY[language].waiting)
        await expect(asking).not.toContainText(/Working|Trabajando/)
        expect((await asking.innerText()).match(/ORCA-14/g)).toHaveLength(1)
      }
    )

    // Reopening the panel starts a new read; a host that stopped answering must not cost the team.
    await failPanelReads(electronApp, true)
    await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarTab('explorer'))
    await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarTab('team'))
    await captureEvery(
      orcaPage,
      testInfo.outputPath.bind(testInfo),
      'read-error-team-kept',
      async (language) => {
        await readError(language)
        await expect(panel.locator('[data-team-card="lead"]')).toBeVisible()
        await expect(cards).toHaveCount(2)
      }
    )
    const readsBeforeSecondRetry = await panelReads(electronApp)
    await panel.getByRole('button', { name: COPY.en.retry }).click()
    await expect.poll(() => panelReads(electronApp)).toBeGreaterThan(readsBeforeSecondRetry)
    await failPanelReads(electronApp, false)
    // Why retry until clear: the next poll can beat the click, and clears the error just the same.
    await expect(async () => {
      const retry = panel.getByRole('button', { name: COPY.en.retry })
      if (await retry.isVisible()) {
        await retry.click({ timeout: 1_000 })
      }
      await expect(panel).not.toContainText(COPY.en.readError, { timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
    await expect(cards).toHaveCount(2)

    // Display and Plain come from the real panel look setting: no scene slot, agents by role.
    const setLook = (look: 'game' | 'display' | 'plain') =>
      orcaPage.evaluate(async (next) => {
        const state = window.__store!.getState()
        const game = state.settings?.orchestratorGame
        await state.updateSettings({
          orchestratorGame: { ...game, panel: { ...game?.panel, look: next } }
        })
      }, look)
    const leadCard = panel.locator('[data-team-card="lead"]')
    // ORCA-1094 row 1: with no Lead name the lead is the quest roster's last character, never the worktree.
    const leadName = 'Elaine'
    await expect(panel.locator('[data-team-scene]')).toHaveCount(1)
    await expect(leadCard).toContainText(leadName)
    for (const look of ['display', 'plain'] as const) {
      await setLook(look)
      await expect(panel.locator('[data-team-scene]')).toHaveCount(0)
      // Display adds its metrics carousel above the tabs; Plain draws none.
      await expect(panel.locator('[aria-roledescription="carousel"]')).toHaveCount(
        look === 'display' ? 1 : 0
      )
      await expect(leadCard).not.toContainText(leadName)
      // ORCA-1094 row 5: as V28 draws Plain and Display, members sit indented under the lead with
      // their status in a column of its own, left of the text, not inline under the ticket.
      const layout = await panel.evaluate((node) => {
        const left = (el: Element | null | undefined) =>
          el?.getBoundingClientRect().left ?? Number.NaN
        const badge = node.querySelector('[data-team-card="lead"] [data-crown]')?.parentElement
        return [...node.querySelectorAll('[data-team-card="member"]')].map((card) => {
          const text = card.querySelector('code')
          const glyph = card.querySelector('[data-status-glyph]')
          return {
            indent: left(text) - left(badge),
            glyphRight: glyph?.getBoundingClientRect().right ?? Number.NaN,
            textLeft: left(text)
          }
        })
      })
      expect(layout.length, `members in ${look}`).toBeGreaterThan(0)
      for (const row of layout) {
        expect(row.indent, `member indent in ${look}`).toBeGreaterThanOrEqual(16)
        expect(row.glyphRight, `status column in ${look}`).toBeLessThanOrEqual(row.textLeft)
      }
      for (const language of ['en', 'es'] as const) {
        await orcaPage.evaluate(
          (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
          language
        )
        await expect(leadCard).toContainText(COPY[language].lead)
        for (const width of WIDTHS) {
          await orcaPage.setViewportSize({ width, height: 900 })
          for (const theme of ['dark', 'light'] as const) {
            await setTheme(orcaPage, theme)
            const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth)
            expect(
              overflow,
              `${look} overflows at ${width}px ${theme} ${language}`
            ).toBeLessThanOrEqual(0)
            await orcaPage.screenshot({
              animations: 'disabled',
              path: testInfo.outputPath(`team-look-${look}-${language}-${width}-${theme}.png`)
            })
          }
        }
      }
    }
    await setLook('game')
    await expect(panel.locator('[data-team-scene]')).toHaveCount(1)

    await orcaPage.evaluate(() => window.__store!.getState().updateSettings({ uiLanguage: 'en' }))
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await panel.getByRole('button', { name: COPY.en.answer }).first().click()
    await expect(panel.getByRole('tab', { name: /Inbox/ })).toHaveAttribute('aria-selected', 'true')

    // One click on a member opens its own terminal in the center and opens its card; Team stays open.
    await panel.getByRole('tab', { name: COPY.en.team }).click()
    const asker = cards.filter({ hasText: 'ORCA-14' })
    await asker.locator('button[aria-expanded]').click()
    await expect(asker.locator('button[aria-expanded]')).toHaveAttribute('aria-expanded', 'true')
    await expect
      .poll(() => orcaPage.evaluate(() => window.__store!.getState().activeTabId))
      .toBe(members[1].paneKey.split(':')[0])
    await captureEvery(
      orcaPage,
      testInfo.outputPath.bind(testInfo),
      'member-card-open',
      async (language) => {
        const detail = asker.locator('[data-team-card-detail]')
        await expect(detail).toBeVisible()
        // Why gone: the card itself opens the terminal, so the button would only repeat it.
        await expect(asker.getByRole('button', { name: COPY[language].open })).toHaveCount(0)
        await expect(detail.getByRole('button', { name: COPY[language].answer })).toBeVisible()
        // Each fact once: the header shows model, phase, time and host, so the grid does not.
        await expect(detail.locator('[data-team-detail]')).toHaveCount(
          (await detail.locator('[data-team-detail="tool"]').count()) + 1
        )
        await expect(detail.locator('[data-team-detail="branch"] code')).not.toContainText(
          'refs/heads/'
        )
        await expect(detail.locator('[data-team-detail="branch"] code')).not.toBeEmpty()
        // A card wider than the panel is cut; the open card's surface must fit it too.
        const spill = await asker.evaluate((node) => {
          const panelBox = node.closest('[data-testid="team-panel"]')!.getBoundingClientRect()
          return node.getBoundingClientRect().right - panelBox.right
        })
        expect(spill).toBeLessThanOrEqual(0)
      }
    )

    // Subagents are helpers inside the member's session: a live count on its row, a line each when open.
    await orcaPage.evaluate((paneKey) => {
      window.__store!.setState((state) => ({
        agentStatusByPaneKey: {
          ...state.agentStatusByPaneKey,
          [paneKey]: {
            ...state.agentStatusByPaneKey[paneKey],
            subagents: [
              { id: 'a1', description: 'Map sidebar rows', state: 'working', startedAt: 1 },
              {
                id: 'a2',
                description: 'Inventory sidebar features',
                state: 'working',
                startedAt: 2
              },
              { id: 'a3', agentType: 'Explore', state: 'idle', startedAt: 3 }
            ]
          }
        }
      }))
    }, members[1].paneKey)
    await captureEvery(
      orcaPage,
      testInfo.outputPath.bind(testInfo),
      'member-helpers',
      async (language) => {
        await expect(asker.locator('[data-team-helpers]')).toHaveText(
          language === 'en' ? '2 helpers' : '2 ayudantes'
        )
        await expect(asker.locator('[data-team-helper]')).toHaveCount(3)
      }
    )
    await orcaPage.evaluate(() => window.__store!.getState().updateSettings({ uiLanguage: 'en' }))
    const askerTab = members[1].paneKey.split(':')[0]
    // Why by tab, not :visible: where both sidebars leave the center 0px wide, the header clips to 0.
    const header = orcaPage.locator(
      `[data-terminal-overlay-tab-id="${askerTab}"] [data-team-member-header]`
    )
    await expect(header).toBeVisible()
    await expect(orcaPage.locator('[data-team-member-header]:visible')).toHaveCount(1)
    await expect(header).toContainText('This computer')
    expect((await header.innerText()).match(/ORCA-14/g)).toHaveLength(1)
    await expect(panel).toBeVisible()
    for (const language of ['en', 'es'] as const) {
      await orcaPage.evaluate(
        (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
        language
      )
      await expect(header).toContainText(COPY[language].awaited)
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        for (const theme of ['dark', 'light'] as const) {
          await setTheme(orcaPage, theme)
          const fit = await header.evaluate((node) => {
            const slot = node.parentElement!.getBoundingClientRect()
            return {
              spill: node.getBoundingClientRect().right - slot.right,
              slot: Math.round(slot.width),
              hidden: node.scrollWidth - node.clientWidth
            }
          })
          testInfo.annotations.push({
            type: 'member-header',
            description: `${language} ${width} ${theme}: slot ${fit.slot}px, hidden ${fit.hidden}px`
          })
          const where = `${width}px ${theme} ${language}`
          expect(fit.spill, `header spills out of the center at ${where}`).toBeLessThanOrEqual(0)
          // Why 300: narrower, both sidebars leave the center terminal itself without columns.
          if (fit.slot >= 300) {
            expect(fit.hidden, `header cuts its facts at ${where}`).toBeLessThanOrEqual(0)
          }
          await orcaPage.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(`member-header-${language}-${width}-${theme}.png`)
          })
        }
      }
    }

    // The gear leaves the panel for Settings, so it runs last, back in English at full width.
    await orcaPage.evaluate(() => window.__store!.getState().updateSettings({ uiLanguage: 'en' }))
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await panel.getByRole('button', { name: 'Project settings' }).click()
    const gameSection = orcaPage.locator('[id^="repo-"][id$="-game"]')
    await expect(gameSection).toBeVisible({ timeout: 15_000 })
    // Why the top: the section already shows low on the project page without being scrolled to.
    await expect
      .poll(async () => (await gameSection.boundingBox())?.y, { timeout: 15_000 })
      .toBeLessThan(200)
  } finally {
    agent.dispose()
  }
})
