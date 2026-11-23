import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
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
const haiku = { model: 'claude-haiku-5-5', effort: 'low' }
const sonnet = { model: 'claude-sonnet-5-5', effort: 'medium' }
const opus = { model: 'claude-opus-5-5', effort: 'high' }

const decision = (at: number, moment: string, from: object, to: object, applied = true) => ({
  at,
  moment,
  phase: moment === 'plan' ? 'map' : 'implement',
  from,
  to,
  applied,
  source: 'plan',
  why: moment
})

const stewardReport = (ticket: string, over: Record<string, unknown>) => ({
  version: 1,
  session: `session-${ticket}`,
  ticket,
  ...opus,
  phase: 'implement',
  plan: 'plan',
  standDown: null,
  pinned: { model: false, effort: false },
  stepsSeen: 4,
  decisions: [],
  ...over
})

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

// Why: a capture taken mid-transition shows half a card (ORCA-1125).
async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((one) => one.effect?.getComputedTiming().endTime !== Infinity)
        .map((one) => one.finished.catch(() => undefined))
    )
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  })
}

// ORCA-1242 PR 3b: with Jev's router off, the Orca steward's pick shows on the member's card, the
// lead's Team list and the member's terminal header; with Jev routing it credits Jev; a pin is kept.
test("Team cards show the Orca steward's model choice and its moves", async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(420_000)
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
    await writeSettings(orcaPage, {
      defaultTuiAgent: 'codex',
      agentCmdOverrides: { codex: agent.command },
      agentDefaultArgs: { codex: '' }
    })
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
          label: 'Lead'
        })
        return registered.result.registered
      })
      .toBe(true)
    const endpoint = await readHookEndpoint(electronApp)
    await emitCodexHookStatus(endpoint, {
      paneKey: pane.paneKey,
      worktreeId,
      state: 'working',
      prompt: 'Lead the team'
    })
    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Steward',
      from: lead
    })
    await expect
      .poll(async () => {
        const listed = await client.call<{ worktrees: { id: string }[] }>('worktree.list', {})
        return listed.result.worktrees.some((one) => one.id === worktreeId)
      })
      .toBe(true)
    const member = async (ticket: string) => {
      const displayName = `${ticket} Steward`
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
        timeoutMs: 20_000
      })
      const handle = started.result.effects.find(
        (effect) => effect.kind === 'terminal' && effect.role === 'agent'
      )?.id
      const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
      const terminal = listed.result.terminals.find((one) => one.handle === handle)
      expect(terminal, `the ${ticket} terminal is not listed`).toBeTruthy()
      return {
        ticket,
        handle: handle!,
        paneKey: `${terminal!.tabId}:${terminal!.leafId}`,
        worktreeId: terminal!.worktreeId
      }
    }
    const raised = await member('ORCA-9101')
    const routed = await member('ORCA-9102')
    const pinned = await member('ORCA-9103')
    // Why: a pane joins its lead's fleet once its hooks report.
    for (const one of [raised, routed, pinned]) {
      await emitCodexHookStatus(endpoint, {
        paneKey: one.paneKey,
        worktreeId: one.worktreeId,
        state: 'working',
        prompt: `Work on ${one.ticket}`
      })
    }
    const t0 = Date.now() - 120_000

    // Each pane posts its steward on its own state poll, as the member's plugin does.
    const reports: [Awaited<ReturnType<typeof member>>, Record<string, unknown>][] = [
      [
        raised,
        stewardReport(raised.ticket, {
          decisions: [
            decision(t0, 'plan', haiku, sonnet),
            {
              ...decision(t0 + 60_000, 'edit', sonnet, opus),
              // ORCA-1350: the raise read a warm 1 h cache and paid its rewrite.
              cache: {
                warm: true,
                known: true,
                ttl: '1h',
                contextTokens: 120_000,
                why: 'upward',
                extraUsd: 0.79,
                breakEven: null
              }
            }
          ]
        })
      ],
      [
        routed,
        stewardReport(routed.ticket, {
          standDown: 'router',
          decisions: [decision(t0, 'edit', sonnet, opus, false)]
        })
      ],
      [
        pinned,
        stewardReport(pinned.ticket, {
          ...sonnet,
          pinned: { model: true, effort: true },
          decisions: [decision(t0, 'edit', sonnet, sonnet, false)]
        })
      ]
    ]
    const report = async (): Promise<void> => {
      for (const [one, steward] of reports) {
        await client.call<OrchestratorGameState>('game.state', {
          worktreeId: one.worktreeId,
          terminalHandle: one.handle,
          paneKey: one.paneKey,
          steward,
          ...(one === routed
            ? {
                advisor: {
                  version: 1,
                  model: 'Opus 5.5',
                  effort: 'high',
                  line: 'jev · model: Opus 5.5 · high effort · code floor (Jev: code)',
                  routedModel: 'claude-opus-5-5',
                  sessionModel: 'claude-sonnet-5-5',
                  pinned: { model: false, effort: false }
                }
              }
            : {})
        })
      }
    }
    await expect
      .poll(
        async () => {
          await report()
          const state = (
            await client.call<OrchestratorGameState>('game.state', {
              worktreeId,
              terminalHandle: lead,
              paneKey: pane.paneKey
            })
          ).result
          return state.agents
            .filter((one) => one.isMember)
            .map((one) => [one.displayName, one.steward?.model ?? null, one.steward?.standDown])
            .sort()
        },
        { timeout: 30_000 }
      )
      .toEqual([
        ['ORCA-9101 Steward', 'claude-opus-5-5', null],
        ['ORCA-9102 Steward', 'claude-opus-5-5', 'router'],
        ['ORCA-9103 Steward', 'claude-sonnet-5-5', null]
      ])

    // The durable log: one file per ticket, each decision once although every poll resends it.
    await report()
    const logDir = path.join(userDataDir, 'orchestrator-game-steward')
    const linesOf = (ticket: string): string[] => {
      const file = readdirSync(logDir).find((one) => one.endsWith(`.${ticket}.steward.jsonl`))
      return file ? readFileSync(path.join(logDir, file), 'utf8').trim().split('\n') : []
    }
    await expect.poll(() => linesOf('ORCA-9101').length).toBe(2)
    expect(JSON.parse(linesOf('ORCA-9101')[1]!)).toMatchObject({
      session: 'session-ORCA-9101',
      moment: 'edit',
      to: opus
    })

    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    const cards = panel.locator('[data-team-card="member"]')
    await expect(cards).toHaveCount(3, { timeout: 90_000 })
    const raisedCard = cards.filter({ hasText: 'ORCA-9101' })
    const routedCard = cards.filter({ hasText: 'ORCA-9102' })
    const pinnedCard = cards.filter({ hasText: 'ORCA-9103' })
    await expect(raisedCard.locator('[data-team-model]')).toHaveText('Sonnet 5.5 → Opus 5.5 · high')
    await expect(routedCard.locator('[data-team-model]')).toHaveText('Sonnet 5.5 → Opus 5.5 · high')
    await expect(pinnedCard.locator('[data-team-model]')).toHaveText('Sonnet 5.5 · medium')

    await orcaPage.addStyleTag({
      content: '[role="tabpanel"] { scrollbar-width: auto; scrollbar-color: auto }'
    })
    const capture = async (name: string, height: number, target?: () => Promise<void>) => {
      await report()
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height })
        for (const theme of ['dark', 'light'] as const) {
          await setTheme(orcaPage, theme)
          await target?.()
          await settled(orcaPage)
          const where = `${name} ${width}px ${theme}`
          const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth)
          expect(overflow, `panel overflows: ${where}`).toBeLessThanOrEqual(0)
          const listOverflow = await panel
            .getByRole('tabpanel')
            .evaluate((node: HTMLElement) => node.scrollWidth - node.clientWidth)
          expect(listOverflow, `list scrolls sideways: ${where}`).toBeLessThanOrEqual(0)
          await panel.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(`${name}-${width}-${theme}.png`)
          })
        }
      }
    }
    await capture('list', 720)

    // The detail says why: the steward's reason, its plan line, its moves and when they apply.
    await pinnedCard.locator('button[aria-expanded]').first().click()
    await expect(pinnedCard.locator('[data-team-detail="modelChoice"] dd')).toHaveText(
      'kept the model pinned at launch (Orca steward)'
    )
    await routedCard.locator('button[aria-expanded]').first().click()
    await expect(routedCard.locator('[data-team-detail="modelChoice"] dd')).toHaveText(
      'code floor (Jev: code)'
    )
    await raisedCard.locator('button[aria-expanded]').first().click()
    const detail = raisedCard.locator('[data-team-detail="steward"] dd')
    await expect(raisedCard.locator('[data-team-detail="modelChoice"] dd')).toHaveText(
      'editing code (Orca steward)'
    )
    await expect(detail.locator('[data-team-steward-plan]')).toHaveText(
      'Following the plan · implement'
    )
    await expect(detail.locator('[data-team-steward-step]')).toHaveCount(2)
    await expect(detail.locator('[data-team-steward-step]').last()).toContainText(
      'editing code · Sonnet 5.5 · medium → Opus 5.5 · high'
    )
    await expect(detail.locator('[data-team-steward-cache="warm"]')).toHaveText(
      /^\S.* the cache was warm · 1 h · 120k tokens: the work needed a bigger model$/
    )
    await expect(detail).toContainText('a new effort from the next turn')
    await capture('card', 900, async () => {
      await raisedCard.evaluate((node) => node.scrollIntoView({ block: 'start' }))
    })

    // The same card in Spanish; the steward keeps its name, as Jev does.
    await writeSettings(orcaPage, { uiLanguage: 'es' })
    await expect(raisedCard.locator('[data-team-detail="modelChoice"] dd')).toHaveText(
      'editando código (Orca steward)'
    )
    await expect(detail.locator('[data-team-steward-plan]')).toHaveText('Sigue el plan · implement')
    await expect(detail.locator('[data-team-steward-cache]')).toHaveText(
      /^\S.* la caché estaba caliente · 1 h · 120k tokens: el trabajo pedía un modelo mayor$/
    )
    await capture('card-es', 900, async () => {
      await raisedCard.evaluate((node) => node.scrollIntoView({ block: 'start' }))
    })
    await writeSettings(orcaPage, { uiLanguage: 'en' })

    // Opening the card opens the member's terminal, whose header says the same.
    const header = orcaPage.locator(
      `[data-terminal-overlay-tab-id="${raised.paneKey.split(':')[0]}"] [data-team-member-header]`
    )
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await expect(header).toContainText(
      'Sonnet 5.5 → Opus 5.5 · high · editing code (Orca steward)',
      { timeout: 30_000 }
    )
    await report()
    for (const width of WIDTHS) {
      await orcaPage.setViewportSize({ width, height: 900 })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        await settled(orcaPage)
        await orcaPage.screenshot({ path: testInfo.outputPath(`header-${width}-${theme}.png`) })
      }
    }
  } finally {
    agent.dispose()
  }
})
