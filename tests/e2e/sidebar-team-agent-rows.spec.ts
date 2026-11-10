import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'
import { worktreeRow } from './worktree-row-locators'

const WIDTHS = [1440, 768, 390, 320]
type Call = (
  event: unknown,
  args: { method: string }
) => Promise<{ result?: Record<string, unknown> }>

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

// Why: E2E has no PR provider, so ORCA-1142's PR is added to the real game.state on its way in.
async function addPr(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Call> })._invokeHandlers
    const real = handlers.get('runtime:call')!
    ipcMain.removeHandler('runtime:call')
    ipcMain.handle('runtime:call', async (event, args: { method: string }) => {
      const response = await real(event, args)
      if (args.method !== 'game.state' || !Array.isArray(response.result?.agents)) {
        return response
      }
      const agents = (response.result.agents as { displayName?: string }[]).map((one) =>
        one.displayName?.includes('ORCA-1142')
          ? {
              ...one,
              review: {
                provider: 'github',
                number: 923,
                title: 'Logins',
                url: 'https://github.com/o/r/pull/923',
                state: 'open',
                ci: 'success'
              }
            }
          : one
      )
      return { ...response, result: { ...response.result, agents } }
    })
  })
}

type RowBox = { role: string | null; x: number; y: number; height: number; connector: string }

// V30: members sit 12 px in from the lead with the tree connector, and every row has one height.
async function expectV30TreeGeometry(page: Page, where: string): Promise<void> {
  const boxes = await page.locator('[data-sidebar-team-row]').evaluateAll((list) =>
    list.map((node): RowBox => {
      const rect = node.getBoundingClientRect()
      return {
        role: node.getAttribute('data-sidebar-team-row'),
        x: rect.x,
        y: rect.y,
        height: rect.height,
        connector: getComputedStyle(node, '::before').borderLeftWidth
      }
    })
  )
  const [lead, ...members] = [...boxes].sort((a, b) => a.y - b.y)
  expect(lead?.role, `the lead row is not first at ${where}`).toBe('lead')
  expect(members, `members missing at ${where}`).toHaveLength(2)
  for (const member of members) {
    expect(Math.round(member.x - lead!.x), `child indent at ${where}`).toBe(12)
    expect(member.connector, `tree connector at ${where}`).toBe('1px')
  }
  const heights = new Set(boxes.map((box) => Math.round(box.height)))
  expect([...heights], `row heights differ at ${where}`).toHaveLength(1)
  const pitches = [members[0]!.y - lead!.y, members[1]!.y - members[0]!.y].map(Math.round)
  expect(pitches[0], `row pitch differs at ${where}`).toBe(pitches[1])
}

const CLEAR = 'rgba(0, 0, 0, 0)'

// ORCA-1148: the lead's card once drew a bordered card around the open member's own bordered card.
async function expectOnlyMemberRowSelected(
  page: Page,
  leadId: string,
  memberId: string,
  { where }: { where: string }
): Promise<void> {
  const look = await page.evaluate(
    ({ leadId, memberId }) => {
      const surfaceOf = (id: string) =>
        document.querySelector<HTMLElement>(
          `[data-worktree-id="${id}"] [data-worktree-card-surface]`
        )!
      const lead = surfaceOf(leadId)
      const member = surfaceOf(memberId)
      const rowOf = (surface: HTMLElement) =>
        surface.querySelector<HTMLElement>('[data-sidebar-team-row]')!
      const fill = (row: HTMLElement) => getComputedStyle(row, '::after').backgroundColor
      const leadBox = lead.getBoundingClientRect()
      const memberRow = rowOf(member).getBoundingClientRect()
      return {
        leadActive: lead.hasAttribute('data-worktree-card-active'),
        memberActive: member.hasAttribute('data-worktree-card-active'),
        leadSurface: [
          getComputedStyle(lead).borderTopColor,
          getComputedStyle(lead).backgroundColor
        ],
        memberSurface: [
          getComputedStyle(member).borderTopColor,
          getComputedStyle(member).backgroundColor
        ],
        leadRowFill: fill(rowOf(lead)),
        memberRowFill: fill(rowOf(member)),
        // The member's fill reaches 6 px past its row; it must stay inside the lead's card.
        memberFillInside: memberRow.right + 6 <= leadBox.right && memberRow.left - 8 >= leadBox.left
      }
    },
    { leadId, memberId }
  )
  expect(look.leadActive, `lead card selected at ${where}`).toBe(false)
  expect(look.memberActive, `member card not selected at ${where}`).toBe(true)
  expect(look.leadSurface, `lead card drawn at ${where}`).toEqual([CLEAR, CLEAR])
  expect(look.memberSurface, `member card drawn at ${where}`).toEqual([CLEAR, CLEAR])
  expect(look.leadRowFill, `lead row filled at ${where}`).toBe(CLEAR)
  expect(look.memberRowFill, `member row not filled at ${where}`).not.toBe(CLEAR)
  expect(look.memberFillInside, `member fill leaves the lead card at ${where}`).toBe(true)
}

async function createBareWorktree(page: Page, client: RuntimeClient, name: string) {
  const id = await page.evaluate(async (branch) => {
    const state = window.__store!.getState()
    const active = Object.values(state.worktreesByRepo)
      .flat()
      .find((worktree) => worktree.id === state.activeWorktreeId)!
    return (await state.createWorktree(active.repoId, branch)).worktree.id
  }, name)
  await expect
    .poll(() =>
      client.call('worktree.show', { worktree: `id:${id}` }).then(
        () => true,
        () => false
      )
    )
    .toBe(true)
  return id
}

// ORCA-1148 S1 and S2: with the Team panel closed, the lead's and members' cards read as V30's rows.
test('the sidebar draws the lead and its members as V30 agent rows', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(420_000)
  const agent = createStdinLoggingAgent()
  try {
    await waitForSessionReady(orcaPage)
    const leadWorktreeId = await waitForActiveWorktree(orcaPage)
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
      const state = window.__store!.getState()
      const repoId = state.getKnownWorktreeById(state.activeWorktreeId!)!.repoId
      await state.updateSettings({
        uiLanguage: 'es',
        defaultTuiAgent: 'codex',
        agentCmdOverrides: { codex: command },
        agentDefaultArgs: { codex: '' },
        orchestratorGameProjects: { [repoId]: { orchestrator: { label: 'Castillo' } } }
      })
      state.setRightSidebarOpen(false)
    }, agent.command)

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
          label: 'Castillo'
        })
        return registered.result.registered
      })
      .toBe(true)
    const endpoint = await readHookEndpoint(electronApp)
    await emitCodexHookStatus(endpoint, {
      paneKey: pane.paneKey,
      worktreeId: leadWorktreeId,
      state: 'working',
      prompt: 'Lead the team'
    })

    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Sidebar rows',
      from: lead
    })
    const member = async (ticket: string, displayName: string) => {
      const worktreeId = await createBareWorktree(orcaPage, client, ticket.toLowerCase())
      const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
        spec: `Work on ${ticket}`,
        taskTitle: displayName,
        run: run.result.run.id,
        callerTerminalHandle: lead
      })
      const started = await client.call<{
        effects: { kind: string; role?: string; id?: string }[]
      }>('orchestration.workerStart', {
        task: task.result.task.id,
        from: lead,
        worktree: `id:${worktreeId}`,
        displayName,
        agent: 'codex',
        timeoutMs: 20_000,
        game: true
      })
      const handle = started.result.effects.find(
        (effect) => effect.kind === 'terminal' && effect.role === 'agent'
      )?.id
      const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
      const terminal = listed.result.terminals.find((one) => one.handle === handle)
      expect(terminal, `the ${ticket} terminal is not listed`).toBeTruthy()
      return { paneKey: `${terminal!.tabId}:${terminal!.leafId}`, worktreeId }
    }
    const knight = await member('ORCA-1142', 'Caballero · ORCA-1142 Keep the look')
    const squire = await member('ORCA-1141', 'Escudero · ORCA-1141 Ask first')
    await addPr(electronApp)
    await client.call('game.ownerAsk', {
      worktreeId: leadWorktreeId,
      terminalHandle: lead,
      ticket: 'ORCA-1141',
      question: '¿Mergeo #14 ahora?',
      options: ['Sí', 'No']
    })
    const postHooks = async (): Promise<void> => {
      await emitCodexHookStatus(endpoint, { ...knight, state: 'working', prompt: 'Work' })
      await emitCodexHookStatus(endpoint, { ...squire, state: 'working', prompt: 'Work' })
    }

    // The Team panel stays closed: the rows read the roster on their own.
    expect(await orcaPage.evaluate(() => window.__store!.getState().rightSidebarOpen)).toBe(false)
    // Why the viewport: the root's resize handle sits 6 px past its edge by design.
    const viewport = orcaPage.locator('[data-worktree-sidebar]')
    const leadRow = worktreeRow(orcaPage, leadWorktreeId).locator('[data-sidebar-team-row="lead"]')
    const knightRow = worktreeRow(orcaPage, knight.worktreeId).locator(
      '[data-sidebar-team-row="member"]'
    )
    const squireRow = worktreeRow(orcaPage, squire.worktreeId).locator(
      '[data-sidebar-team-row="member"]'
    )
    await expect
      .poll(
        async () => {
          await postHooks()
          return (await knightRow.count()) + (await squireRow.count()) + (await leadRow.count())
        },
        { timeout: 120_000, message: 'the sidebar never drew the team rows' }
      )
      .toBe(3)

    await expect(leadRow.locator('[data-game-lead-crown]')).toBeVisible()
    await expect(leadRow.locator('[data-team-row-part="name"] b')).toHaveText('Castillo')
    // The lead's branch prints short, not as the `refs/heads/…` game.state carries; CI's git seeds `master`.
    const leadBranch = await orcaPage.evaluate(
      (id) => window.__store!.getState().getKnownWorktreeById(id)!.branch,
      leadWorktreeId
    )
    expect(leadBranch).toMatch(/^refs\/heads\//)
    await expect(leadRow.locator('[data-team-row-ticket]')).toHaveText(
      leadBranch.replace(/^refs\/heads\//, '')
    )
    // The lead row carries its age, like the members.
    await expect(leadRow.locator('[data-team-row-part="age"]')).toHaveText(/\S/)
    await expect(knightRow.locator('[data-team-row-part="name"] b')).toHaveText('Caballero')
    await expect(knightRow.locator('[data-team-row-ticket]')).toHaveText('ORCA-1142')
    await expect(knightRow.locator('[data-team-row-part="kind"]')).toHaveAttribute(
      'data-kind',
      'pr',
      { timeout: 60_000 }
    )
    await expect(knightRow.locator('[data-team-row-part="kind"]')).toHaveAttribute(
      'data-ci-tone',
      'success'
    )
    await expect(squireRow.locator('[data-team-row-part="kind"]')).toHaveAttribute(
      'data-kind',
      'branch'
    )
    await expect(squireRow.locator('[data-status-glyph="question"]')).toBeVisible({
      timeout: 60_000
    })
    expect(
      await knightRow.evaluate((node) =>
        [...node.children].map((child) => child.getAttribute('data-team-row-part'))
      )
    ).toEqual(['state', 'kind', 'name', 'age'])
    // S2: members sit under the lead as children.
    expect(
      await orcaPage.evaluate(
        (ids) =>
          ids.map((id) => window.__store?.getState().worktreeLineageById[id]?.parentWorktreeId),
        [knight.worktreeId, squire.worktreeId]
      )
    ).toEqual([leadWorktreeId, leadWorktreeId])

    // Why: another feature's first-run hint would sit on the narrow captures.
    await expect(orcaPage.getByText('se movió a la barra inferior').first()).toBeHidden({
      timeout: 15_000
    })
    for (const width of WIDTHS) {
      await orcaPage.setViewportSize({ width, height: 720 })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        const where = `${width}px ${theme}`
        const overflow = await viewport.evaluate((node) => node.scrollWidth - node.clientWidth)
        expect(overflow, `sidebar list overflows at ${where}`).toBeLessThanOrEqual(0)
        // Why the parts, not scrollWidth: the selection fill (`::after`) reaches past the row by design.
        const cutRows = await orcaPage.locator('[data-sidebar-team-row]').evaluateAll((list) =>
          list
            .filter((node) => {
              const right = node.getBoundingClientRect().right
              return [...node.children].some((part) => part.getBoundingClientRect().right > right)
            })
            .map((node) => node.textContent)
        )
        expect(cutRows, `team rows overflow at ${where}`).toEqual([])
        await expectV30TreeGeometry(orcaPage, where)
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`rows-game-${width}-${theme}.png`)
        })
      }
    }

    // V30 with a member open: only that member's row is filled; the lead's card draws no card.
    await knightRow.click()
    await expect
      .poll(() => orcaPage.evaluate(() => window.__store!.getState().activeWorktreeId))
      .toBe(knight.worktreeId)
    // Why: opening the member offers its repo's detected setup script over the rows being captured.
    const setupPrompt = orcaPage.locator('[data-setup-script-prompt-layer]')
    const dismissSetup = setupPrompt.getByRole('button', {
      name: 'Descartar scripts de configuración'
    })
    if (
      await dismissSetup.waitFor({ timeout: 10_000 }).then(
        () => true,
        () => false
      )
    ) {
      await dismissSetup.click()
    }
    await expect(setupPrompt).toBeHidden()
    await orcaPage.mouse.move(0, 0)
    for (const width of WIDTHS) {
      await orcaPage.setViewportSize({ width, height: 720 })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        await expectOnlyMemberRowSelected(orcaPage, leadWorktreeId, knight.worktreeId, {
          where: `${width}px ${theme}`
        })
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`rows-member-open-${width}-${theme}.png`)
        })
      }
    }

    // V30's hoverHtml: pointing at a member opens its card alone, never the lead's behind it.
    // Why: only the new card style gives a card its hover card; the write is not awaited in the
    // evaluate (ORCA-895), the store is polled instead.
    await orcaPage.evaluate(() => {
      void window.__store!.getState().updateSettings({ experimentalNewWorktreeCardStyle: true })
    })
    await expect
      .poll(() =>
        orcaPage.evaluate(
          () => window.__store!.getState().settings?.experimentalNewWorktreeCardStyle === true
        )
      )
      .toBe(true)
    const hoverCards = orcaPage.locator('[data-slot="hover-card-content"]')
    for (const width of [1440, 320]) {
      await orcaPage.setViewportSize({ width, height: 720 })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        await orcaPage.mouse.move(0, 0)
        await expect(hoverCards).toHaveCount(0)
        await knightRow.hover()
        await expect(hoverCards, `hover cards at ${width}px ${theme}`).toHaveCount(1)
        await expect(hoverCards).toContainText('orca-1142')
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`rows-member-hover-${width}-${theme}.png`)
        })
      }
    }
    await orcaPage.mouse.move(0, 0)

    // Plain mode names a member by its ticket only and the lead by its role.
    await orcaPage.setViewportSize({ width: 1440, height: 720 })
    await setTheme(orcaPage, 'dark')
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      const game = state.settings?.orchestratorGame
      return state.updateSettings({
        orchestratorGame: { ...game, panel: { ...game?.panel, look: 'plain' } }
      })
    })
    await expect(knightRow.locator('[data-team-row-part="name"] b')).toHaveText('ORCA-1142', {
      timeout: 60_000
    })
    await expect(leadRow.locator('[data-team-row-part="name"] b')).toHaveText('Líder')
    await orcaPage.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('rows-plain-1440-dark.png')
    })
  } finally {
    agent.dispose()
  }
})
