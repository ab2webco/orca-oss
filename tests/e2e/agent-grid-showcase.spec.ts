import { rm } from 'node:fs/promises'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import {
  execInTerminal,
  sendToTerminal,
  splitActiveTerminalPane,
  waitForPaneCount,
  waitForPaneIdentitySnapshot
} from './helpers/terminal'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal } from './helpers/orca-restart'
import { claudeVersionOk } from './helpers/orchestrator-game-band'
import { CLIP_ARGS, showcaseClip } from './helpers/showcase-clip'
import { writeShowcaseClaude } from './helpers/showcase-claude'
import { startMessagesApi } from './helpers/showcase-messages-api'
import { createShowcaseRepo } from './helpers/showcase-repo'

test.use({ seedTestRepo: false, orcaAppExtraArgs: CLIP_ARGS })

// The README and site agent-grid clip: four Claude Code sessions in the Lumen app answer at
// once, and the grid sorts them into buckets. Each cell is a real pane streaming real output.
const WINDOW_WIDTH = 1440
const WINDOW_HEIGHT = 900
const HOLD_MS = 1_400

// The status each pane is seeded with, the prompt typed into it, and the answer it streams.
const AGENTS = [
  {
    state: 'blocked',
    title: 'LUM-12 Dark mode toggle',
    prompt: 'LUM-12: add the dark mode toggle to Settings.',
    answer:
      'The toggle is wired to src/settings/theme.ts and follows the system by default. ' +
      'Before I style it: should the dark surface reuse #0f1115 from the landing page, or ' +
      'do you want a new token in the design system? I will wait for your call.'
  },
  {
    state: 'working',
    title: 'LUM-14 Offline cache for the feed',
    prompt: 'LUM-14: cache the feed so it reads offline.',
    answer:
      'Plan: keep the last 200 stories in the feed store, capped at 40 MB, and evict the ' +
      'oldest first. I am adding cacheFeed() in src/feed/offline-cache.ts, a read-through ' +
      'in fetchFeed() when the network fails, and tests for the cap and the eviction order. ' +
      'Next I will run the feed tests and open the PR against main.'
  },
  {
    state: 'done',
    title: 'LUM-15 Onboarding copy',
    prompt: 'LUM-15: tighten the onboarding copy.',
    answer:
      'Done. The three onboarding screens now say what Lumen does in one line each, the ' +
      'buttons read "Continue" and "Start reading", and PR #43 is open with CI green.'
  },
  {
    state: 'working',
    title: 'LUM-18 Retry failed uploads',
    prompt: 'LUM-18: retry failed photo uploads.',
    answer:
      'Failed uploads now go to a queue that retries with backoff: 1 s, 2 s, 4 s, up to ' +
      'five tries, and only on Wi-Fi when the photo is over 10 MB. I am writing the queue ' +
      'tests now, then a banner that shows how many uploads are waiting.'
  }
] as const

async function resizeWindow(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) {
        throw new Error('No Electron window')
      }
      window.setSize(size.width, size.height)
    },
    { width: WINDOW_WIDTH, height: WINDOW_HEIGHT }
  )
}

async function seedAgentStatus(
  page: Page,
  paneKey: string,
  state: 'blocked' | 'working' | 'done',
  title: string,
  prompt: string
): Promise<void> {
  await page.evaluate(
    ({ paneKey, state, title, prompt }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      const now = Date.now()
      store
        .getState()
        .setAgentStatus(
          paneKey,
          { state, prompt, agentType: 'claude', lastAssistantMessage: title },
          title,
          { updatedAt: now, stateStartedAt: now - 1_000 }
        )
    },
    { paneKey, state, title, prompt }
  )
}

async function openAgentGrid(page: Page): Promise<void> {
  // The in-window drawer host sits behind an experimental setting.
  await page.evaluate(async () => {
    const settings = await window.api.settings.set({ experimentalAgentDashboardPopout: true })
    window.__store?.setState({ settings })
    window.__store?.getState().setSidebarOpen?.(true)
  })
  await page.evaluate(() => {
    window.__store?.getState().setAgentDashboardDrawerOpen(true)
  })
}

function gridCells(page: Page) {
  return page.locator('[data-agent-grid-cell]')
}

function bucketButton(page: Page, label: RegExp) {
  return page
    .locator('[data-agent-grid-controls] [aria-pressed]')
    .filter({ hasText: label })
    .first()
}

test('agent grid groups live agents into buckets and filters them', async ({
  orcaPage: page,
  electronApp
}, testInfo) => {
  // Why a fallback: CI has no Claude Code, and the bucket checks must still run there.
  const live = claudeVersionOk()
  test.setTimeout(240_000)
  await waitForSessionReady(page)
  await resizeWindow(electronApp)

  const repo = createShowcaseRepo()
  const api = await startMessagesApi(
    AGENTS.map((agent) => ({ match: new RegExp(agent.prompt.slice(0, 7)), text: agent.answer }))
  )
  const claude = live
    ? await writeShowcaseClaude({ projectDir: repo, apiUrl: api.url, theme: 'light' })
    : null
  try {
    await attachRepoAndOpenTerminal(page, repo)
    await ensureTerminalVisible(page)
    await splitActiveTerminalPane(page, 'vertical')
    await splitActiveTerminalPane(page, 'horizontal')
    await splitActiveTerminalPane(page, 'vertical')
    await waitForPaneCount(page, 4)
    const snapshot = await waitForPaneIdentitySnapshot(page, 4)

    const paneKeys = snapshot.panes.map((pane) => `${snapshot.tabId}:${pane.leafId}`)
    expect(paneKeys.length, 'four panes give one agent per bucket').toBe(4)
    const ptyIds = snapshot.panes.map((pane) => pane.ptyId ?? '')
    expect(ptyIds.every(Boolean), 'every pane needs a live pty').toBe(true)

    // Why the answers first without Claude: a pane back at its prompt clears a seeded status.
    for (const [index, ptyId] of ptyIds.entries()) {
      const run = claude ? `'${claude.launcher}'` : `printf '%s\\n' '${AGENTS[index]!.answer}'`
      await execInTerminal(page, ptyId, `PS1='$ '; clear; ${run}`)
    }
    const tails = () =>
      page.evaluate(async (ids) => {
        const readings = await window.api.agentTerminalTail?.readPtys(ids, 40)
        return (readings ?? []).map((r) => (r.tail && r.tail.read ? r.tail.lines.join('\n') : ''))
      }, ptyIds)
    await expect
      .poll(
        async () =>
          (await tails()).every((tail, index) =>
            tail.includes(live ? 'Claude Code' : AGENTS[index]!.answer.slice(0, 10))
          ),
        {
          timeout: 60_000,
          message: 'a pane never drew its prompt'
        }
      )
      .toBe(true)

    for (const [index, agent] of AGENTS.entries()) {
      await seedAgentStatus(page, paneKeys[index]!, agent.state, agent.title, agent.prompt)
    }
    await openAgentGrid(page)
    await expect.poll(() => gridCells(page).count(), { timeout: 30_000 }).toBe(4)
    await expect(page.getByText('Workspace board moved to the bottom bar')).toHaveCount(0, {
      timeout: 15_000
    })
    await page.waitForTimeout(800)

    const clip = await showcaseClip(electronApp, testInfo, 'agent-grid')
    await page.waitForTimeout(1_000)
    // Why staggered: the owner types into one agent after another, as they would.
    for (const [index, agent] of AGENTS.entries()) {
      if (live) {
        await sendToTerminal(page, ptyIds[index]!, `${agent.prompt}\r`)
        await page.waitForTimeout(500)
      }
    }
    if (live) {
      await expect.poll(() => api.prompts.length, { timeout: 20_000 }).toBe(4)
    }
    await page.waitForTimeout(HOLD_MS * 2)

    await bucketButton(page, /Working/).click()
    await expect.poll(() => gridCells(page).count()).toBe(2)
    await page.waitForTimeout(HOLD_MS)

    await bucketButton(page, /Done/).click()
    await expect.poll(() => gridCells(page).count()).toBe(1)
    await page.waitForTimeout(HOLD_MS)

    // The filter is single-select, so the active bucket clears when pressed again.
    await bucketButton(page, /Done/).click()
    await expect.poll(() => gridCells(page).count()).toBe(4)
    // Why no whitespace: the narrow panes wrap the answer, mid-word without Claude.
    await expect
      .poll(async () => (await tails()).join('').replace(/\s+/g, ''), { timeout: 20_000 })
      .toContain('howmanyuploadsarewaiting')
    await page.waitForTimeout(HOLD_MS * 2)
    await clip.stop()
  } finally {
    await api.close()
    if (claude) {
      await rm(claude.root, { recursive: true, force: true })
    }
  }
})
