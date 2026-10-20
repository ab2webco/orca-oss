import { randomUUID } from 'node:crypto'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { worktreeRow } from './worktree-row-locators'

// Game members' branches are named after their ticket; `orca-<n>` once read as the creature `orca`
// at collision tier <n>, so the first prompt raised a "rename failed" badge (ORCA-696).
const GAME_BRANCHES = ['orca-901', 'orca-902', 'orca-903']
// A real creature name keeps the pipeline honest: it must still reach the badge.
const CONTROL_BRANCH = 'narwhal'
const RENAME_FAILED_BADGE = '[aria-label="Auto-rename failed: view error"]'

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    window.__store?.setState({ settings })
  }, theme)
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

async function createWorktree(page: Page, name: string): Promise<string> {
  return page.evaluate(async (worktreeName) => {
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('store unavailable')
    }
    const worktrees = Object.values(state.worktreesByRepo).flat()
    const active =
      worktrees.find((worktree) => worktree.id === state.activeWorktreeId) ?? worktrees[0]
    if (!active) {
      throw new Error('active worktree was not found')
    }
    const result = await state.createWorktree(active.repoId, worktreeName)
    return result.worktree.id
  }, name)
}

async function readRenameError(page: Page, worktreeId: string): Promise<string | null> {
  return page.evaluate((id) => {
    const state = window.__store?.getState()
    const worktree = Object.values(state?.worktreesByRepo ?? {})
      .flat()
      .find((candidate) => candidate.id === id)
    return worktree?.firstAgentMessageRenameError ?? null
  }, worktreeId)
}

test('a game member branch named after its ticket never shows the rename-failed badge', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(180_000)
  await waitForSessionReady(orcaPage)
  // No Source Control AI agent, so an eligible branch fails at generation and raises the badge.
  await orcaPage.evaluate(async () => {
    const settings = await window.api.settings.set({
      autoRenameBranchFromWork: true,
      defaultTuiAgent: 'blank',
      disabledTuiAgents: ['claude']
    })
    window.__store?.setState({ settings })
  })

  const gameIds: string[] = []
  for (const branch of GAME_BRANCHES) {
    gameIds.push(await createWorktree(orcaPage, branch))
  }
  const controlId = await createWorktree(orcaPage, CONTROL_BRANCH)

  // A badge stored by the old gate (and surviving a restart) must clear on the next prompt.
  const staleId = gameIds[0]
  const seeded = await orcaPage.evaluate(async (id) => {
    const state = window.__store?.getState()
    await state?.updateWorktreeMeta(id, { firstAgentMessageRenameError: 'stale from old gate' })
    const meta = await window.api.worktrees.updateMeta({
      worktreeId: id,
      updates: { firstAgentMessageRenameError: 'stale from old gate' }
    })
    return meta?.firstAgentMessageRenameError ?? null
  }, staleId)
  expect(seeded, 'the stale badge never reached main').toBe('stale from old gate')
  await expect(worktreeRow(orcaPage, staleId).locator(RENAME_FAILED_BADGE)).toBeVisible()

  const endpoint = await readHookEndpoint(electronApp)
  const emitFirstPrompt = (worktreeId: string, ticket: string) =>
    emitCodexHookStatus(endpoint, {
      paneKey: `e2e-${ticket}:${randomUUID()}`,
      worktreeId,
      state: 'working',
      prompt: `Work on ${ticket.toUpperCase()}`
    })
  for (const [index, id] of gameIds.entries()) {
    await emitFirstPrompt(id, GAME_BRANCHES[index])
  }
  await emitFirstPrompt(controlId, CONTROL_BRANCH)

  // The control proves the hook reached the rename gate; without it "no badge" proves nothing.
  await expect
    .poll(() => readRenameError(orcaPage, controlId), { timeout: 30_000 })
    .toMatch(/Source Control AI agent/)
  await expect(worktreeRow(orcaPage, controlId).locator(RENAME_FAILED_BADGE)).toBeVisible()

  await expect.poll(() => readRenameError(orcaPage, staleId), { timeout: 15_000 }).toBeNull()
  for (const id of gameIds) {
    expect(await readRenameError(orcaPage, id), id).toBeNull()
    await expect(worktreeRow(orcaPage, id)).toBeVisible()
    await expect(worktreeRow(orcaPage, id).locator(RENAME_FAILED_BADGE)).toHaveCount(0)
  }

  for (const width of [1440, 768, 390, 320]) {
    await orcaPage.setViewportSize({ width, height: 900 })
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(orcaPage, theme)
      await orcaPage.screenshot({
        path: testInfo.outputPath(`game-members-sidebar-${width}-${theme}.png`)
      })
    }
  }
})
