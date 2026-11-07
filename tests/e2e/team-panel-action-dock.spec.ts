import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'
import type { RuntimeTerminalListResult, RuntimeTerminalRead } from '../../src/shared/runtime-types'

const WIDTHS = [1440, 768, 390, 320]
// Why: the capture matrix outruns the CI test budget; ORCA_CAPTURE_EVIDENCE=1 runs it locally.
const CAPTURE_EVIDENCE = process.env.ORCA_CAPTURE_EVIDENCE === '1'

const ORCA_YAML = [
  'orchestratorGame:',
  '  tracker: false',
  '  actions:',
  '    - label: Release',
  '      command: release',
  '      icon: tag',
  '      pin: true',
  '      prompt: Prepare the release and tell me what is missing.',
  '    - label: Deploy staging',
  '      command: deploy',
  '      icon: ship',
  '      pin: true',
  '      prompt: Deploy to staging and tell me the result.',
  '    - label: Board',
  '      command: board',
  '      mcp: { server: plane, tool: list_work_items }',
  ''
].join('\n')

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    window.__store?.setState({ settings })
  }, theme)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(theme === 'dark')
}

/** Every chip the row shows sits on one line inside it; the ones that do not fit are hidden. */
async function expectOneLine(dock: Locator, where: string): Promise<number> {
  const fit = await dock.evaluate((node) => {
    const row = node.querySelector('[data-team-action]')?.parentElement
    if (!row) {
      return null
    }
    const box = row.getBoundingClientRect()
    const shown = [...row.querySelectorAll<HTMLElement>('[data-team-action]:not([aria-hidden])')]
    return {
      shown: shown.length,
      tops: new Set(shown.map((chip) => Math.round(chip.getBoundingClientRect().top))).size,
      spill: Math.max(...shown.map((chip) => chip.getBoundingClientRect().right - box.right)),
      dockSpill: node.scrollWidth - node.clientWidth
    }
  })
  expect(fit, `no chip row at ${where}`).not.toBeNull()
  expect(fit!.shown, `no chip shown at ${where}`).toBeGreaterThan(0)
  expect(fit!.tops, `chips wrap at ${where}`).toBe(1)
  expect(fit!.spill, `a shown chip is cut at ${where}`).toBeLessThanOrEqual(1)
  expect(fit!.dockSpill, `the dock overflows at ${where}`).toBeLessThanOrEqual(0)
  return fit!.shown
}

// Why: the app's star and update cards can open mid-run over the panel's foot, where the dock is.
async function dismissAppCards(page: Page): Promise<void> {
  for (const name of [/^(Later|Más tarde)$/, /^(Dismiss|Descartar)$/]) {
    for (const one of await page.getByRole('button', { name }).all()) {
      if (await one.isVisible().catch(() => false)) {
        await one.click()
      }
    }
  }
}

// Why: a card can open after a dismiss and cover the dock's corner, so each try dismisses again.
async function clickPastAppCards(page: Page, target: Locator): Promise<void> {
  await expect(async () => {
    await dismissAppCards(page)
    await target.click({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
}

// Why: after a resize the pointer can rest on the sidebar's board button, whose tooltip covers the dock.
async function clearForCapture(page: Page): Promise<void> {
  await dismissAppCards(page)
  await page.mouse.move(0, 0)
  await expect(
    page.getByText(/Workspace board moved|tablero de espacios de trabajo se movió/)
  ).toBeHidden({ timeout: 20_000 })
}

async function captureDock(page: Page, panel: Locator, file: string): Promise<void> {
  await clearForCapture(page)
  const box = await panel.boundingBox()
  if (!box) {
    return
  }
  const height = Math.min(box.height, 240)
  await page.screenshot({
    animations: 'disabled',
    path: file,
    clip: { x: box.x, y: box.y + box.height - height, width: box.width, height }
  })
}

// A real lead pane and real members; the dock is drawn from the lead's own game.state (ORCA-1093).
test('the action dock shows what applies now, runs it on the lead and shows its reply', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(CAPTURE_EVIDENCE ? 600_000 : 300_000)
  const agent = createStdinLoggingAgent()
  try {
    await waitForSessionReady(orcaPage)
    // Why: the star card opens on agent counts and covered the dock in CI and in captures.
    await orcaPage.evaluate(() => window.api.ui.set({ starNagCompleted: true }))
    const worktreeId = await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActivePanePtyId(orcaPage)
    const pane = await waitForActivePaneHookDescriptor(orcaPage)
    const worktreePath = await orcaPage.evaluate(
      (id) => window.__store!.getState().getKnownWorktreeById(id)!.path,
      worktreeId
    )
    writeFileSync(path.join(worktreePath, 'orca.yaml'), ORCA_YAML)
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
    const leadHook = { paneKey: pane.paneKey, worktreeId }
    await emitCodexHookStatus(endpoint, { ...leadHook, state: 'working', prompt: 'Lead' })

    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Action dock',
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
      return {
        paneKey: `${terminal!.tabId}:${terminal!.leafId}`,
        worktreeId: terminal!.worktreeId
      }
    }
    const members = [await member('ORCA-12'), await member('ORCA-14')]
    // Both members stop at their prompt: push applies to them; with no To Do, wave does not.
    await expect
      .poll(
        async () => {
          for (const one of members) {
            await emitCodexHookStatus(endpoint, {
              ...one,
              state: 'done',
              lastAssistantMessage: 'Paused'
            })
          }
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
    await emitCodexHookStatus(endpoint, {
      ...leadHook,
      state: 'done',
      lastAssistantMessage: 'Ready'
    })

    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    const dock = panel.locator('[data-team-action-dock]')
    await expect(panel.getByRole('region', { name: 'Actions' })).toBeVisible({ timeout: 90_000 })
    const chips = dock.locator('[data-team-action]')
    await expect(chips).toHaveText(['Push2', 'Release', 'Deploy staging'], { timeout: 90_000 })
    await expect(dock.getByRole('button', { name: 'Stop every member' })).toBeEnabled()
    await expect(dock).not.toContainText(/Board|Wave|Sweep|Status/)

    for (const [language, theme] of [
      ['en', 'dark'],
      ['es', 'light']
    ] as const) {
      await orcaPage.evaluate(
        (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
        language
      )
      await setTheme(orcaPage, theme)
      await expect(chips.first()).toHaveText(language === 'en' ? 'Push2' : 'Reactivar2')
      await expect(chips.first()).toHaveAccessibleName(
        language === 'en' ? 'Push, 2 stopped' : 'Reactivar, 2 detenidos'
      )
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        const shown = await expectOneLine(dock, `${width}px ${language}`)
        testInfo.annotations.push({
          type: 'dock',
          description: `${width} ${language}: ${shown} chips`
        })
        if (CAPTURE_EVIDENCE) {
          await captureDock(
            orcaPage,
            panel,
            testInfo.outputPath(`dock-${language}-${width}-${theme}.png`)
          )
          if (width === 1440 || width === 320) {
            await clearForCapture(orcaPage)
            await orcaPage.screenshot({
              animations: 'disabled',
              path: testInfo.outputPath(`window-${language}-${width}-${theme}.png`)
            })
          }
        }
      }
    }

    // The menu holds every action: what applies now, this project's, then Orca's, each with why.
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await clickPastAppCards(orcaPage, dock.getByRole('button', { name: 'Todas las acciones' }))
    const menu = orcaPage.getByRole('menu', { name: 'Todas las acciones' })
    await expect(menu.locator('h4')).toHaveText(['Ahora', 'De este proyecto', 'De Orca'])
    await expect(menu.getByRole('menuitem')).toHaveText([
      /^Reactivar.*2 detenidos$/,
      /^Release.*\/release$/,
      /^Deploy staging.*\/deploy$/,
      /^Board.*\/board$/,
      /^Ola.*Nada por hacer$/,
      /^Estado.*\/status$/,
      /^Barrer.*Nada por cerrar$/,
      /^Detener.*\/stop$/
    ])
    await expect(menu.getByRole('menuitem', { name: /^Ola/ })).toBeDisabled()
    await expect(menu.getByPlaceholder('Buscar acción')).toBeFocused()
    // The menu opens over the dock it spans, at every sidebar width (ORCA-1092 row 19).
    const sidebarBefore = await orcaPage.evaluate(
      () => window.__store!.getState().rightSidebarWidth
    )
    for (const sidebar of [300, 456, 600]) {
      await orcaPage.evaluate((w) => window.__store!.getState().setRightSidebarWidth(w), sidebar)
      await expect
        .poll(async () => {
          const [box, dockBox] = await Promise.all([menu.boundingBox(), dock.boundingBox()])
          if (!box || !dockBox) {
            return 'unmeasured'
          }
          const inside =
            box.x >= dockBox.x - 1 && box.x + box.width <= dockBox.x + dockBox.width + 1
          const gap = Math.round(dockBox.y - (box.y + box.height))
          return inside && gap >= 0 && gap <= 12 ? 'over the dock' : `x ${box.x} gap ${gap}`
        }, `menu at sidebar ${sidebar}`)
        .toBe('over the dock')
    }
    await orcaPage.evaluate(
      (w) => window.__store!.getState().setRightSidebarWidth(w),
      sidebarBefore
    )
    if (CAPTURE_EVIDENCE) {
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(orcaPage, theme)
        for (const width of WIDTHS) {
          await orcaPage.setViewportSize({ width, height: 900 })
          await clearForCapture(orcaPage)
          const box = await menu.boundingBox()
          const panelBox = await panel.boundingBox()
          expect(
            box && panelBox && box.x >= panelBox.x - 1,
            `menu leaves the panel at ${width}`
          ).toBe(true)
          await orcaPage.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(`menu-es-${width}-${theme}.png`),
            clip: { x: panelBox!.x, y: 300, width: panelBox!.width, height: 600 }
          })
        }
      }
      await orcaPage.setViewportSize({ width: 1440, height: 900 })
    }
    await menu.getByPlaceholder('Buscar acción').fill('dep')
    await expect(menu.getByRole('menuitem')).toHaveText([/^Deploy staging/])
    await orcaPage.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    // Stop asks inline, in the dock, and sends nothing on Cancel.
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await clickPastAppCards(orcaPage, dock.getByRole('button', { name: 'Detener a todos' }))
    await expect(dock).toContainText(
      '¿Detener a los 2 miembros? Siguen parados hasta que los reactives.'
    )
    if (CAPTURE_EVIDENCE) {
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(orcaPage, theme)
        for (const width of WIDTHS) {
          await orcaPage.setViewportSize({ width, height: 900 })
          await captureDock(
            orcaPage,
            panel,
            testInfo.outputPath(`stop-confirm-es-${width}-${theme}.png`)
          )
        }
      }
    }
    await clickPastAppCards(orcaPage, dock.getByRole('button', { name: 'Cancelar' }))
    await expect(chips).toHaveCount(3)

    // The lead's own Stop hook carries the reply the dock shows: lastAssistantMessage reaches it.
    await orcaPage.evaluate(() => window.__store!.getState().updateSettings({ uiLanguage: 'en' }))
    await setTheme(orcaPage, 'dark')
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await clickPastAppCards(orcaPage, chips.filter({ hasText: 'Release' }))
    await expect(chips.filter({ hasText: 'Release' }).locator('[data-agent-spinner]')).toBeVisible()
    await expect(chips.filter({ hasText: 'Push' })).toBeDisabled()
    // Why squashed: the lead's pane wraps the prompt at its width.
    await expect
      .poll(async () => {
        const read = await client.call<{ terminal: RuntimeTerminalRead }>('terminal.read', {
          terminal: lead,
          limit: 200
        })
        return read.result.terminal.tail.join('').replace(/\s/g, '')
      }, 'the lead pane never got the Release prompt')
      .toContain('Preparethereleaseandtellmewhatismissing.')
    await emitCodexHookStatus(endpoint, {
      ...leadHook,
      state: 'working',
      prompt: 'Prepare the release'
    })
    await emitCodexHookStatus(endpoint, {
      ...leadHook,
      state: 'done',
      lastAssistantMessage: 'Two PRs still have to merge before the release.\nDetails follow.'
    })
    const receipt = dock.getByRole('status')
    await expect(receipt).toContainText('Release: Two PRs still have to merge before the release.')
    await expect(chips.filter({ hasText: 'Push' })).toBeEnabled()
    if (CAPTURE_EVIDENCE) {
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        for (const width of WIDTHS) {
          await orcaPage.setViewportSize({ width, height: 900 })
          await expect(dock.getByRole('status')).toBeVisible()
          await captureDock(orcaPage, panel, testInfo.outputPath(`reply-en-${width}-${theme}.png`))
        }
      }
    }

    // New action opens Settings > Actions on its form; Edit opens the section with none.
    const actionsSection = orcaPage.locator('[id$="-game-actions"]')
    const menuEn = orcaPage.getByRole('menu', { name: 'All actions' })
    for (const [item, form] of [
      ['New action', 1],
      ['Edit', 0]
    ] as const) {
      await orcaPage.evaluate(() => window.__store!.getState().closeSettingsPage())
      await clickPastAppCards(orcaPage, dock.getByRole('button', { name: 'All actions' }))
      await clickPastAppCards(orcaPage, menuEn.getByRole('button', { name: item, exact: true }))
      await expect(menuEn).toBeHidden()
      await expect(actionsSection).toBeInViewport({ timeout: 15_000 })
      await expect(actionsSection.locator('[data-slot="game-action-form"]')).toHaveCount(form)
    }
  } finally {
    agent.dispose()
  }
})
