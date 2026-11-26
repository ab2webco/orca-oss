/**
 * ORCA-1216 §6: a lead's freed members stay under it as Entregados, named by ticket, PR number and
 * state, newest first. Rows freed over 24 h ago fold into one count row, except a CI failure, and
 * the character's name lives in the row's hover card. Needs E2E: the rows come from the lead's real
 * history (game.history) and lineage, nested inside the lead's card in the real sidebar.
 */

import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { dismissWorkspaceBoardMovedHint } from './helpers/workspace-board-moved-hint'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'
import { worktreeRow } from './worktree-row-locators'

const WIDTHS = [1440, 768, 390, 320]
const HOUR = 3_600_000

type Freed = {
  ticket: string
  character: string
  hoursAgo: number
  pr: { number: number; state: 'open' | 'merged'; status: 'success' | 'pending' | 'failure' }
}

// One merged and one open inside 24 h, a CI failure past 24 h that must stay, two merged past 24 h.
const FREED: Freed[] = [
  {
    ticket: 'ORCA-1203',
    character: 'Peach',
    hoursAgo: 2,
    pr: { number: 1208, state: 'merged', status: 'success' }
  },
  {
    ticket: 'ORCA-1195',
    character: 'Toad',
    hoursAgo: 0.7,
    pr: { number: 1206, state: 'open', status: 'pending' }
  },
  {
    ticket: 'ORCA-1198',
    character: 'Yoshi',
    hoursAgo: 25,
    pr: { number: 1205, state: 'open', status: 'failure' }
  },
  {
    ticket: 'ORCA-1170',
    character: 'Daisy',
    hoursAgo: 30,
    pr: { number: 1180, state: 'merged', status: 'success' }
  },
  {
    ticket: 'ORCA-1166',
    character: 'Wario',
    hoursAgo: 50,
    pr: { number: 1176, state: 'merged', status: 'success' }
  }
]

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
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

// Why seeded: E2E has no PR provider, so each freed branch's review is put in the card's cache;
// fetchedAt in the future keeps the 60 s cache from refetching it to nothing mid-test.
async function seedReviews(
  page: Page,
  freed: readonly (Freed & { branch: string; worktreeId: string })[]
) {
  await page.evaluate((rows) => {
    const store = window.__store!
    const state = store.getState()
    const repoId = Object.values(state.worktreesByRepo).flat()[0]!.repoId
    const cache = { ...state.hostedReviewCache }
    for (const row of rows) {
      // Why the head: a merged PR shows on a card only when it is that worktree's own head.
      const head = state.getKnownWorktreeById(row.worktreeId)?.head
      cache[`local::${repoId}::${row.branch}`] = {
        data: {
          provider: 'github' as const,
          number: row.pr.number,
          title: `Ship ${row.ticket}`,
          state: row.pr.state,
          url: `https://github.com/acme/orca/pull/${row.pr.number}`,
          status: row.pr.status,
          updatedAt: new Date().toISOString(),
          mergeable: 'MERGEABLE' as const,
          ...(head ? { headSha: head } : {})
        },
        fetchedAt: Date.now() + 86_400_000,
        linkedReviewHintKey: `github:${row.pr.number}`,
        branchLookupGitHubPRNumber: row.pr.number
      }
    }
    store.setState({ hostedReviewCache: cache })
  }, freed)
}

test('freed members stay under their lead as Entregados, by ticket, PR and state', async ({
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
    const repoId = await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      return state.getKnownWorktreeById(state.activeWorktreeId!)!.repoId
    })
    await writeSettings(orcaPage, {
      uiLanguage: 'es',
      defaultTuiAgent: 'codex',
      agentCmdOverrides: { codex: agent.command },
      agentDefaultArgs: { codex: '' },
      orchestratorGameProjects: { [repoId]: { orchestrator: { label: 'Alfred' } } }
    })
    await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarOpen(false))

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
    await emitCodexHookStatus(endpoint, {
      paneKey: pane.paneKey,
      worktreeId: leadWorktreeId,
      state: 'working',
      prompt: 'Lead the team'
    })

    // The one live member, launched the way the lead launches one.
    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Delivered rows',
      from: lead
    })
    const liveWorktreeId = await createBareWorktree(orcaPage, client, 'orca-1199')
    const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: 'Work on ORCA-1199',
      taskTitle: 'Luigi · ORCA-1199 Panel tests',
      run: run.result.run.id,
      callerTerminalHandle: lead
    })
    const started = await client.call<{
      effects: { kind: string; role?: string; id?: string }[]
    }>('orchestration.workerStart', {
      task: task.result.task.id,
      from: lead,
      worktree: `id:${liveWorktreeId}`,
      displayName: 'Luigi · ORCA-1199 Panel tests',
      agent: 'codex',
      timeoutMs: 20_000,
      game: true
    })
    const handle = started.result.effects.find(
      (effect) => effect.kind === 'terminal' && effect.role === 'agent'
    )?.id
    const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
    const terminal = listed.result.terminals.find((one) => one.handle === handle)
    expect(terminal, 'the live member terminal is not listed').toBeTruthy()
    const live = { paneKey: `${terminal!.tabId}:${terminal!.leafId}`, worktreeId: liveWorktreeId }

    // The freed members: a worktree under the lead and the record the lead writes when it frees one.
    const freed: (Freed & { worktreeId: string; branch: string })[] = []
    for (const row of FREED) {
      const branch = row.ticket.toLowerCase()
      const worktreeId = await createBareWorktree(orcaPage, client, branch)
      await orcaPage.evaluate(
        ({ child, parent }) =>
          window.__store!.getState().assignWorktreeParent(child, { parentWorktreeId: parent }),
        { child: worktreeId, parent: leadWorktreeId }
      )
      await client.call('game.historyRecord', {
        worktreeId: leadWorktreeId,
        terminalHandle: lead,
        memberWorktreeId: worktreeId,
        character: row.character,
        record: {
          ticket: row.ticket,
          repo: null,
          branch,
          agent: 'codex',
          account: null,
          launchedAt: null,
          endedAt: new Date(Date.now() - row.hoursAgo * HOUR).toISOString(),
          outcome: row.pr.state === 'merged' ? 'merged' : 'stopped',
          pr: `#${row.pr.number} ${row.pr.state}`,
          lastReport: null,
          character: row.character
        }
      })
      freed.push({ ...row, worktreeId, branch })
    }
    // Peach's earlier ticket, whose worktree is long gone: only the hover card names it.
    await client.call('game.historyRecord', {
      worktreeId: leadWorktreeId,
      terminalHandle: lead,
      character: 'Peach',
      record: {
        ticket: 'ORCA-1149',
        repo: null,
        branch: 'orca-1149',
        agent: 'codex',
        account: null,
        launchedAt: null,
        endedAt: new Date(Date.now() - 200 * HOUR).toISOString(),
        outcome: 'merged',
        pr: '#1150 merged',
        lastReport: null,
        character: 'Peach'
      }
    })
    await seedReviews(orcaPage, freed)
    // Why the reselect: opening the member worktrees moved the active one off the lead.
    await orcaPage.evaluate(
      (id) => window.__store!.getState().setActiveWorktree(id),
      leadWorktreeId
    )

    const byTicket = (ticket: string) => freed.find((one) => one.ticket === ticket)!
    const deliveredRow = (ticket: string) =>
      worktreeRow(orcaPage, byTicket(ticket).worktreeId).locator(
        '[data-sidebar-team-row="delivered"]'
      )
    const liveRow = worktreeRow(orcaPage, live.worktreeId).locator(
      '[data-sidebar-team-row="member"]'
    )
    const header = orcaPage.locator('[data-sidebar-delivered-header]')
    await expect
      .poll(
        async () => {
          await emitCodexHookStatus(endpoint, { ...live, state: 'working', prompt: 'Work' })
          return (await liveRow.count()) + (await header.count())
        },
        { timeout: 120_000, message: 'the sidebar never drew the live member and Entregados' }
      )
      .toBe(2)

    // Entregados · 5 counts every row it lists, the two folded past 24 h included (ORCA-1245).
    await expect(header.locator('[data-delivered-label]')).toHaveText('Entregados')
    await expect(header.locator('[data-delivered-count]')).toHaveText('5')
    // The two inside 24 h and the CI failure, newest first.
    const recentIds = () =>
      orcaPage
        .locator('[data-delivered-slot="recent"] > [data-worktree-id]')
        .evaluateAll((list) => list.map((node) => node.getAttribute('data-worktree-id')))
    await expect
      .poll(recentIds)
      .toEqual(['ORCA-1195', 'ORCA-1203', 'ORCA-1198'].map((t) => byTicket(t).worktreeId))
    const lineOf = (ticket: string) => deliveredRow(ticket).locator('[data-delivered-pr-line]')
    await expect(deliveredRow('ORCA-1203').locator('[data-team-row-part="name"]')).toHaveText(
      'ORCA-1203'
    )
    await expect(lineOf('ORCA-1203')).toHaveText('#1208 · mergeado')
    await expect(lineOf('ORCA-1195')).toHaveText('#1206 · abierto')
    await expect(lineOf('ORCA-1198')).toHaveText('#1205 · CI falla')
    await expect(lineOf('ORCA-1198')).toHaveAttribute('data-delivered-kind', 'ciFailing')
    await expect(deliveredRow('ORCA-1203')).not.toContainText('Peach')
    // Live members come first, then the group.
    const order = await orcaPage
      .locator('[data-sidebar-team-children]')
      .first()
      .evaluate((node) => {
        const ids = [
          ...node.querySelectorAll('[data-worktree-id], [data-sidebar-delivered-header]')
        ]
        return ids.map((one) => one.getAttribute('data-worktree-id') ?? 'header')
      })
    expect(order[0]).toBe(live.worktreeId)
    expect(order[1]).toBe('header')

    // The two merged past 24 h fold into the count row.
    const toggle = orcaPage.locator('[data-sidebar-delivered-folded-toggle]')
    await expect(toggle).toHaveText('2 entregados · más de 24 h')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    for (const ticket of ['ORCA-1170', 'ORCA-1166']) {
      await expect(deliveredRow(ticket)).toBeHidden()
    }

    await dismissWorkspaceBoardMovedHint(orcaPage)
    await orcaPage.mouse.move(0, 0)
    const capture = async (state: string): Promise<void> => {
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        for (const theme of ['dark', 'light'] as const) {
          await setTheme(orcaPage, theme)
          const cut = await orcaPage
            .locator('[data-sidebar-team-row="delivered"]:visible')
            .evaluateAll((list) =>
              list
                .filter((node) => {
                  const right = node.getBoundingClientRect().right
                  return [...node.querySelectorAll('[data-team-row-part]')].some(
                    (part) => part.getBoundingClientRect().right > right + 0.5
                  )
                })
                .map((node) => node.textContent)
            )
          expect(cut, `delivered rows overflow at ${width}px ${theme}`).toEqual([])
          await orcaPage.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(`delivered-${state}-${width}-${theme}.png`)
          })
        }
      }
    }
    await capture('folded')

    const activeOf = () => orcaPage.evaluate(() => window.__store!.getState().activeWorktreeId)
    const activeBefore = await activeOf()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(lineOf('ORCA-1170')).toHaveText('#1180 · mergeado')
    await expect(lineOf('ORCA-1166')).toHaveText('#1176 · mergeado')
    expect(await activeOf(), 'the count row changed the open workspace').toBe(activeBefore)
    await orcaPage.mouse.move(0, 0)
    await capture('opened')

    // The hover card carries what the row leaves out: who did it, the PR, the branch, the lead.
    // At every width it stays inside the window: under the row where beside it would not fit.
    const hoverCard = orcaPage.locator('[data-sidebar-delivered-hover]')
    for (const width of WIDTHS) {
      await orcaPage.setViewportSize({ width, height: 900 })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        await orcaPage.mouse.move(0, 0)
        await expect(hoverCard).toHaveCount(0)
        await deliveredRow('ORCA-1203').hover()
        await expect(hoverCard).toBeVisible()
        await expect(hoverCard.locator('[data-delivered-hover-header]')).toHaveText(
          'ORCA-1203· Hecho por Peach'
        )
        await expect(hoverCard.locator('[data-delivered-field="pr"]')).toHaveText(
          'PR#1208 mergeado'
        )
        await expect(hoverCard.locator('[data-delivered-field="title"]')).toHaveText(
          'TítuloShip ORCA-1203'
        )
        await expect(hoverCard.locator('[data-delivered-field="branch"]')).toHaveText(
          'Ramaorca-1203'
        )
        await expect(hoverCard.locator('[data-delivered-field="lead"]')).toContainText('Alfred · ')
        await expect(hoverCard.locator('[data-delivered-field="freed"]')).toContainText(
          'worktree en espera'
        )
        await expect(hoverCard.locator('[data-delivered-also]')).toHaveText(
          'Peach también: ORCA-1149 (mergeado)'
        )
        // Why poll: Radix places the card a frame after it becomes visible.
        await expect
          .poll(
            () =>
              hoverCard.evaluate((node) => {
                const box = node.getBoundingClientRect()
                return box.left >= 0 && box.right <= window.innerWidth && box.width > 0
              }),
            { message: `the hover card runs past the window at ${width}px ${theme}` }
          )
          .toBe(true)
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`delivered-hover-${width}-${theme}.png`)
        })
      }
    }
    await orcaPage.mouse.move(0, 0)
  } finally {
    agent.dispose()
  }
})
