/**
 * Invariant: each worktree state reaches the sidebar in its status tone — working
 * blue, needs-you red, done green, open PR checks by outcome — in both themes (ORCA-1070).
 * An unread row keeps its status dot and shows unread in its title weight, never in red (ORCA-1131).
 * Needs E2E: the tones are CSS variables resolved per theme class, so only a real
 * cascade shows the painted colour a user sees for each state.
 * ORCA_E2E_CAPTURE=1 also saves every width, theme and language for review.
 */

import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, switchToWorktree, waitForSessionReady } from './helpers/store'
import { waitForPaneIdentitySnapshot } from './helpers/terminal'

type AgentRow = { name: string; state: 'working' | 'blocked' | 'done'; tone: string }

const AGENT_ROWS: AgentRow[] = [
  { name: 'working', state: 'working', tone: 'info' },
  { name: 'needs-you', state: 'blocked', tone: 'attention' },
  { name: 'done', state: 'done', tone: 'success' }
]

const REVIEW_ROWS = [
  { name: 'pr-failing', number: 901, state: 'open', status: 'failure' },
  { name: 'pr-running', number: 902, state: 'open', status: 'pending' }
] as const

const CAPTURE = process.env.ORCA_E2E_CAPTURE === '1'
const WIDTHS = [1440, 768, 390, 320] as const

async function applySettings(page: Page, updates: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set(next)
    window.__store?.setState({ settings })
  }, updates)
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await applySettings(page, { theme })
  await expect
    .poll(() =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

/** The main window floors at 600px, so phone widths need the floor lifted first. */
async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
}

async function createWorktree(page: Page, name: string): Promise<string> {
  return page.evaluate(async (worktreeName) => {
    const state = window.__store!.getState()
    const repoId = Object.values(state.worktreesByRepo).flat()[0]!.repoId
    return (await state.createWorktree(repoId, worktreeName)).worktree.id
  }, name)
}

async function seedAgent(page: Page, worktreeId: string, row: AgentRow): Promise<void> {
  await switchToWorktree(page, worktreeId)
  await ensureTerminalVisible(page)
  const snapshot = await waitForPaneIdentitySnapshot(page, 1)
  const paneKey = `${snapshot.tabId}:${snapshot.panes[0]!.leafId}`
  await page.evaluate(
    ({ paneKey, state, name }) => {
      const now = Date.now()
      window
        .__store!.getState()
        .setAgentStatus(
          paneKey,
          { state, prompt: name, agentType: 'claude', lastAssistantMessage: name },
          name,
          { updatedAt: now, stateStartedAt: now - 1_000 }
        )
    },
    { paneKey, state: row.state, name: row.name }
  )
}

async function seedReview(page: Page, row: (typeof REVIEW_ROWS)[number]): Promise<void> {
  await page.evaluate((review) => {
    const store = window.__store!
    const state = store.getState()
    const repoId = Object.values(state.worktreesByRepo).flat()[0]!.repoId
    const data = {
      provider: 'github' as const,
      number: review.number,
      title: review.name,
      state: review.state,
      url: `https://github.com/acme/orca/pull/${review.number}`,
      status: review.status,
      updatedAt: new Date().toISOString(),
      mergeable: 'MERGEABLE' as const
    }
    store.setState({
      hostedReviewCache: {
        ...store.getState().hostedReviewCache,
        [`local::${repoId}::${review.name}`]: {
          data,
          fetchedAt: Date.now(),
          linkedReviewHintKey: `github:${review.number}`,
          branchLookupGitHubPRNumber: review.number
        }
      }
    })
  }, row)
}

/** The painted colour of a row's status marker, and the tone it claims. */
function rowMarker(page: Page, name: string) {
  return page.evaluate((rowName) => {
    const row = [...document.querySelectorAll<HTMLElement>('[data-worktree-card-surface]')].find(
      (card) => card.textContent?.includes(rowName)
    )
    const marker = row?.querySelector<HTMLElement>('[data-status-tone]')
    const painted = marker?.querySelector<HTMLElement>('span, svg') ?? marker
    if (!marker || !painted) {
      return null
    }
    const style = getComputedStyle(painted)
    return {
      tone: marker.dataset.statusTone ?? null,
      color: style.backgroundColor !== 'rgba(0, 0, 0, 0)' ? style.backgroundColor : style.color,
      borderColor: style.borderLeftColor
    }
  }, name)
}

function tokenRgb(page: Page, tone: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span')
    probe.style.color = `var(--status-${name})`
    document.body.appendChild(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, tone)
}

async function capture(
  app: ElectronApplication,
  page: Page,
  testInfo: TestInfo,
  tag: string
): Promise<void> {
  for (const width of WIDTHS) {
    await setWindowWidth(app, page, width)
    await page.waitForTimeout(250)
    await page.screenshot({ path: testInfo.outputPath(`sidebar-${tag}-${width}.png`) })
  }
}

test('worktree states reach the sidebar in their status tones', async ({
  electronApp,
  orcaPage
}, testInfo: TestInfo) => {
  test.setTimeout(CAPTURE ? 300_000 : 120_000)
  await waitForSessionReady(orcaPage)
  await setWindowWidth(electronApp, orcaPage, 1440)
  await orcaPage.evaluate(() =>
    window.__store!.setState({ worktreeCardProperties: ['status', 'pr'] })
  )

  for (const row of AGENT_ROWS) {
    await seedAgent(orcaPage, await createWorktree(orcaPage, row.name), row)
  }
  const unreadId = await createWorktree(orcaPage, 'unread')
  const reviewIds: string[] = []
  for (const row of REVIEW_ROWS) {
    reviewIds.push(await createWorktree(orcaPage, row.name))
    await seedReview(orcaPage, row)
  }
  await switchToWorktree(orcaPage, reviewIds[0]!)
  await orcaPage.evaluate((id) => window.__store!.getState().markWorktreeUnread(id), unreadId)

  for (const theme of ['light', 'dark'] as const) {
    await setTheme(orcaPage, theme)
    for (const row of AGENT_ROWS) {
      const expected = await tokenRgb(orcaPage, row.tone)
      await expect
        .poll(() => rowMarker(orcaPage, row.name), { message: `${theme} ${row.name}` })
        .toMatchObject({ tone: row.tone })
      const marker = (await rowMarker(orcaPage, row.name))!
      expect(
        row.state === 'working' ? marker.borderColor : marker.color,
        `${theme} ${row.name} paints --status-${row.tone}`
      ).toBe(expected)
    }
    const unreadRow = orcaPage.locator('[data-worktree-card-surface]', { hasText: 'unread' })
    expect(await rowMarker(orcaPage, 'unread'), `${theme} unread keeps its dot`).toMatchObject({
      tone: 'idle'
    })
    await expect(unreadRow.locator('.text-status-attention')).toHaveCount(0)
    await expect(unreadRow.locator('[data-worktree-title-inline-rename]').first()).toHaveClass(
      /font-semibold/
    )
    for (const [name, tone] of [
      ['pr-failing', 'attention'],
      ['pr-running', 'info']
    ] as const) {
      const card = orcaPage.locator('[data-worktree-card-surface]', { hasText: name })
      await expect(card.locator(`.text-status-${tone}`).first(), `${theme} ${name}`).toBeVisible()
    }
  }

  // Why: the new card style moves PR state into the status slot.
  await applySettings(orcaPage, { experimentalNewWorktreeCardStyle: true })
  if (CAPTURE) {
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(orcaPage, theme)
      await orcaPage.screenshot({
        path: testInfo.outputPath(`sidebar-newcard-en-${theme}-1440.png`)
      })
    }
  }
  await applySettings(orcaPage, { experimentalNewWorktreeCardStyle: false })

  if (!CAPTURE) {
    return
  }
  for (const language of ['en', 'es'] as const) {
    await applySettings(orcaPage, { uiLanguage: language })
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(orcaPage, theme)
      await capture(electronApp, orcaPage, testInfo, `${language}-${theme}`)
    }
  }
})
