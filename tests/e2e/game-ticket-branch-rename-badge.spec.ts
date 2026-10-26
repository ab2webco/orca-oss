import { randomUUID } from 'node:crypto'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { worktreeRow } from './worktree-row-locators'

// Game members' branches are named after their ticket; `orca-<n>` once read as the creature `orca`
// at collision tier <n>, so the first prompt raised a "rename failed" badge (ORCA-696).
const GAME_BRANCHES = ['orca-901', 'orca-902', 'orca-903']
// Real creature names keep the pipeline honest: each must still reach the rename gate.
const NO_AGENT_BRANCH = 'manatee'
const FAILING_AGENT_BRANCH = 'narwhal'
// A configured agent that cannot start, so generation itself fails (ENOENT on every platform).
const MISSING_AGENT_BINARY = 'orca-e2e-missing-branch-namer'
// No ticket and no words, so the failed generation has no fallback name and must raise the badge.
const UNNAMEABLE_PROMPT = '?!'
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
  // No Source Control AI agent configured yet: #655 makes that a quiet setup state, not a failure.
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
  const noAgentId = await createWorktree(orcaPage, NO_AGENT_BRANCH)
  const failingAgentId = await createWorktree(orcaPage, FAILING_AGENT_BRANCH)

  // A badge stored by an old gate (and surviving a restart) must clear on the next prompt.
  const seedStaleBadge = (worktreeId: string) =>
    orcaPage.evaluate(async (id) => {
      const state = window.__store?.getState()
      await state?.updateWorktreeMeta(id, { firstAgentMessageRenameError: 'stale from old gate' })
      const meta = await window.api.worktrees.updateMeta({
        worktreeId: id,
        updates: { firstAgentMessageRenameError: 'stale from old gate' }
      })
      return meta?.firstAgentMessageRenameError ?? null
    }, worktreeId)
  const staleId = gameIds[0]
  for (const id of [staleId, noAgentId]) {
    expect(await seedStaleBadge(id), 'the stale badge never reached main').toBe(
      'stale from old gate'
    )
    await expect(worktreeRow(orcaPage, id).locator(RENAME_FAILED_BADGE)).toBeVisible()
  }

  const endpoint = await readHookEndpoint(electronApp)
  const emitFirstPrompt = (worktreeId: string, prompt: string) =>
    emitCodexHookStatus(endpoint, {
      paneKey: `e2e-${worktreeId}:${randomUUID()}`,
      worktreeId,
      state: 'working',
      prompt
    })

  // Missing agent: the gate runs and clears the stale badge instead of raising a new one.
  // Only the clear proves the hook reached the gate; "no badge" alone proves nothing.
  await emitFirstPrompt(noAgentId, UNNAMEABLE_PROMPT)
  await expect.poll(() => readRenameError(orcaPage, noAgentId), { timeout: 30_000 }).toBeNull()
  await expect(worktreeRow(orcaPage, noAgentId).locator(RENAME_FAILED_BADGE)).toHaveCount(0)

  // Configured agent whose generation fails: an eligible branch still raises the badge.
  await orcaPage.evaluate(async (binary) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    await store.getState().updateSettings({
      sourceControlAi: {
        ...store.getState().settings.sourceControlAi,
        enabled: true,
        agentId: 'custom' as const,
        customAgentCommand: binary
      }
    })
  }, MISSING_AGENT_BINARY)

  for (const [index, id] of gameIds.entries()) {
    await emitFirstPrompt(id, `Work on ${GAME_BRANCHES[index].toUpperCase()}`)
  }
  await emitFirstPrompt(failingAgentId, UNNAMEABLE_PROMPT)

  await expect
    .poll(() => readRenameError(orcaPage, failingAgentId), { timeout: 30_000 })
    .toContain(MISSING_AGENT_BINARY)
  await expect(worktreeRow(orcaPage, failingAgentId).locator(RENAME_FAILED_BADGE)).toBeVisible()

  // Game members' ticket branches never reach generation, so no badge even with the failing agent.
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
