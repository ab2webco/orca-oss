/**
 * Invariant: every control the zero-to-expert docs name (docs/user, ORCA-1178) is on screen where
 * the page says, in the words it uses. Each step also saves its capture in light and dark for the
 * docs; the fictitious Lumen repo stands in for a real one. ORCA_DOCS_CAPTURE=1 on macOS puts it at
 * a fixed fictitious path, so the Run on row shows no temp folder.
 */

import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ElectronApplication, Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { attachRepoAndOpenTerminal } from './helpers/orca-restart'
import { createShowcaseRepo } from './helpers/showcase-repo'
import { writeSettings } from './helpers/settings-write'
import { ensureTerminalVisible, switchToWorktree, waitForSessionReady } from './helpers/store'
import { waitForPaneIdentitySnapshot } from './helpers/terminal'

const WINDOW = { width: 1280, height: 800 }
const DOCS_REPO = '/Users/Shared/orca-docs/lumen-app'
const ONBOARDING_ADVANCE = /^Continue\b|^Add your first project\b/
const OPTIONAL_STEPS = [/Set up GitHub tasks|Connect your task sources/i, /Set Windows terminal/i]

async function setWindowSize(
  app: ElectronApplication,
  page: Page,
  size: { width: number; height: number } = WINDOW
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, target) => {
    BrowserWindow.getAllWindows()[0]?.setSize(target.width, target.height)
  }, size)
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(size.width)
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(() =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

type Region = Locator | (() => Promise<{ x: number; y: number; width: number; height: number }>)

/** The Lumen repo; at DOCS_REPO when capturing for the docs, else in a temp folder. */
function docsRepo(): string {
  const repo = createShowcaseRepo()
  if (process.env.ORCA_DOCS_CAPTURE !== '1' || process.platform !== 'darwin') {
    return repo
  }
  rmSync(dirname(DOCS_REPO), { recursive: true, force: true })
  mkdirSync(dirname(DOCS_REPO), { recursive: true })
  renameSync(repo, DOCS_REPO)
  return DOCS_REPO
}

/** Saves `<name>.png` and `<name>.dark.png`, the names the docs transform pairs by theme. */
async function captureBothThemes(
  page: Page,
  testInfo: TestInfo,
  name: string,
  region: Region
): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    // Why: theme tokens repaint over a transition; a capture mid-way mixes both themes.
    await page.waitForTimeout(400)
    const path = testInfo.outputPath(`${name}${theme === 'dark' ? '.dark' : ''}.png`)
    await (typeof region === 'function'
      ? page.screenshot({ path, clip: await region() })
      : region.screenshot({ path }))
  }
}

/** The box around `target` from the window's left edge, so a sidebar shows its header too. */
function fromLeftEdge(target: Locator, pad = 6, right = -2) {
  return async () => {
    const box = await target.boundingBox()
    if (!box) {
      throw new Error('capture target is not on screen')
    }
    // Why `right` stops short of the row: past it the panel's border and the title bar show.
    return { x: 0, y: 0, width: box.x + box.width + right, height: box.y + box.height + pad }
  }
}

async function visible(page: Page, heading: RegExp): Promise<boolean> {
  return page
    .getByRole('heading', { name: heading })
    .waitFor({ state: 'visible', timeout: 1_500 })
    .then(() => true)
    .catch(() => false)
}

async function continueOnboarding(page: Page): Promise<void> {
  await page.locator('footer').getByRole('button', { name: ONBOARDING_ADVANCE }).first().click()
}

async function seedAgentStatus(
  page: Page,
  worktreeId: string,
  prompt: string,
  state: 'working' | 'waiting' | 'done' = 'working'
): Promise<void> {
  await switchToWorktree(page, worktreeId)
  await ensureTerminalVisible(page)
  const snapshot = await waitForPaneIdentitySnapshot(page, 1)
  const paneKey = `${snapshot.tabId}:${snapshot.panes[0]!.leafId}`
  await page.evaluate(
    ({ paneKey, prompt, state }) => {
      const now = Date.now()
      window
        .__store!.getState()
        .setAgentStatus(
          paneKey,
          { state, prompt, agentType: 'claude', lastAssistantMessage: prompt },
          prompt,
          { updatedAt: now, stateStartedAt: now - 1_000 }
        )
    },
    { paneKey, prompt, state }
  )
}

/** Stubs the hosted-review reads so Source Control offers a new pull request for `branch`. */
async function seedPullRequestForm(page: Page, worktreeId: string, branch: string): Promise<void> {
  await page.evaluate(
    ({ worktreeId, branch }) => {
      const store = window.__store!
      const state = store.getState()
      const worktree = Object.values(state.worktreesByRepo)
        .flat()
        .find((entry) => entry.id === worktreeId)!
      // Why the cast: these stubs return just the fields Source Control reads, not whole results.
      store.setState(
        (current) =>
          ({
            repos: current.repos.map((repo) =>
              repo.id === worktree.repoId ? { ...repo, worktreeBaseRef: 'origin/main' } : repo
            ),
            gitStatusByWorktree: { ...current.gitStatusByWorktree, [worktreeId]: [] },
            remoteStatusesByWorktree: {
              ...current.remoteStatusesByWorktree,
              [worktreeId]: {
                hasUpstream: true,
                upstreamName: `origin/${branch}`,
                ahead: 0,
                behind: 0
              }
            },
            getHostedReviewCreationEligibility: async () => ({
              provider: 'github' as const,
              review: null,
              canCreate: true,
              blockedReason: null,
              nextAction: null,
              defaultBaseRef: 'origin/main',
              head: branch
            }),
            fetchHostedReviewForBranch: async () => null,
            setUpstreamStatus: () => undefined,
            fetchUpstreamStatus: async () => undefined,
            fetchPRForBranch: async () => null,
            fetchPRChecks: async () => [],
            fetchPRComments: async () => []
          }) as unknown as Partial<typeof current>
      )
      state.setActiveWorktree(worktreeId)
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('source-control')
    },
    { worktreeId, branch }
  )
}

type SeededChecks = { conclusion: 'success' | 'failure'; mergeStateStatus: 'BLOCKED' | 'CLEAN' }

/** Seeds a fictitious open PR (#42 on lumen/lumen-app) with three checks, then opens Checks. */
async function seedOpenPullRequest(
  page: Page,
  worktreeId: string,
  branch: string,
  seeded: SeededChecks
): Promise<void> {
  await page.evaluate(
    ({ worktreeId, branch, seeded }) => {
      const store = window.__store!
      const state = store.getState()
      const worktree = Object.values(state.worktreesByRepo)
        .flat()
        .find((entry) => entry.id === worktreeId)!
      const repo = state.repos.find((entry) => entry.id === worktree.repoId)!
      const pr = {
        number: 42,
        title: 'Cache the feed so it reads offline',
        state: 'open' as const,
        url: 'https://github.com/lumen/lumen-app/pull/42',
        checksStatus: seeded.conclusion,
        updatedAt: new Date().toISOString(),
        mergeable: 'MERGEABLE' as const,
        mergeStateStatus: seeded.mergeStateStatus,
        autoMergeAllowed: false,
        mergeMethodSettings: {
          defaultMethod: 'squash' as const,
          allowedMethods: { squash: true, merge: true, rebase: true }
        },
        prRepo: { owner: 'lumen', repo: 'lumen-app' }
      }
      const checks = ['build', 'lint', 'unit tests'].map((name) => ({
        name,
        status: 'completed' as const,
        conclusion: name === 'unit tests' ? seeded.conclusion : ('success' as const),
        url: null
      }))
      const entries = {
        [`${repo.id}::${branch}`]: { data: pr, fetchedAt: Date.now() },
        [`${repo.path}::${branch}`]: { data: pr, fetchedAt: Date.now() }
      }
      // Why the cast: these stubs return just the fields Checks reads, not whole results.
      store.setState(
        (current) =>
          ({
            prCache: { ...current.prCache, ...entries },
            gitStatusByWorktree: { ...current.gitStatusByWorktree, [worktreeId]: [] },
            remoteStatusesByWorktree: {
              ...current.remoteStatusesByWorktree,
              [worktreeId]: {
                hasUpstream: true,
                upstreamName: `origin/${branch}`,
                ahead: 0,
                behind: 0
              }
            },
            fetchPRForBranch: async (_repoPath: string, target: string) => {
              if (target !== branch) {
                return null
              }
              store.setState((next) => ({ prCache: { ...next.prCache, ...entries } }))
              return pr
            },
            fetchHostedReviewForBranch: async () => null,
            fetchPRChecks: async () => checks,
            fetchPRComments: async () => [],
            fetchUpstreamStatus: async () => undefined,
            setUpstreamStatus: () => undefined
          }) as unknown as Partial<typeof current>
      )
      state.setActiveWorktree(worktreeId)
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('checks')
    },
    { worktreeId, branch, seeded }
  )
}

test.describe('Get started: first launch to a project', () => {
  test.use({ dismissOnboarding: false, seedTestRepo: false })

  test('onboarding names the agent, theme and notifications steps, then Add a project', async ({
    electronApp,
    orcaPage: page
  }, testInfo) => {
    test.setTimeout(180_000)
    await waitForSessionReady(page)
    await setWindowSize(electronApp, page)
    await expect(page.getByRole('heading', { name: /Pick your default agent/i })).toBeVisible({
      timeout: 15_000
    })
    await expect.soft(page.getByText('Yolo / Dangerously skip permissions').first()).toBeVisible()
    // The agent picker only: the step's heading down to the detected agents, 722px wide.
    const heading = page.getByRole('heading', { name: /Pick your default agent/i })
    const more = page.getByText(/Show \d+ more agents/i).first()
    await captureBothThemes(page, testInfo, 'first-launch', async () => {
      const top = (await heading.boundingBox())!
      const end = (await more.boundingBox())!
      const x = top.x - 24
      const y = top.y - 42
      return { x, y, width: 722, height: end.y + end.height + 16 - y }
    })

    await continueOnboarding(page)
    await expect(page.getByRole('heading', { name: /Make it feel like home/i })).toBeVisible()
    await continueOnboarding(page)
    for (const step of OPTIONAL_STEPS) {
      if (await visible(page, step)) {
        await continueOnboarding(page)
      }
    }
    await expect(page.getByRole('heading', { name: /Set up notifications/i })).toBeVisible()
    await continueOnboarding(page)
    for (const step of OPTIONAL_STEPS) {
      if (await visible(page, step)) {
        await continueOnboarding(page)
      }
    }

    const addProject = page.getByRole('dialog', { name: /Add a project/i })
    await expect(addProject).toBeVisible({ timeout: 15_000 })
    for (const label of [/Browse folder/i, /Clone from URL/i, /Create new project/i]) {
      await expect.soft(addProject.getByText(label).first()).toBeVisible()
    }
    await captureBothThemes(page, testInfo, 'add-a-project', addProject)
  })
})

test.describe('Get started: a workspace, its agent and the pull request', () => {
  test.use({ seedTestRepo: false })

  test('the New workspace dialog, the working row and the pull request form', async ({
    electronApp,
    orcaPage: page
  }, testInfo) => {
    test.setTimeout(180_000)
    await waitForSessionReady(page)
    await setWindowSize(electronApp, page)
    const repo = docsRepo()
    try {
      await attachRepoAndOpenTerminal(page, repo)

      await page.getByRole('button', { name: 'New workspace', exact: true }).click()
      const composer = page.getByRole('dialog', { name: /Create (Workspace|Worktree)/i })
      await expect(composer).toBeVisible()
      const nameField = composer.getByPlaceholder(/Type a name/i)
      await nameField.fill('offline-feed')
      // Why: the composer's first Escape only blurs the name, closing its suggestions over Agent.
      await page.keyboard.press('Escape')
      await expect(nameField).not.toBeFocused()
      for (const label of ['Project', 'Run on', 'Agent']) {
        await expect.soft(composer.getByText(label, { exact: true }).first()).toBeVisible()
      }
      await expect
        .soft(composer.getByRole('button', { name: /Create (Workspace|Worktree)/i }))
        .toBeVisible()
      await captureBothThemes(page, testInfo, 'create-workspace', composer)
      await page.keyboard.press('Escape')
      await expect(composer).toBeHidden()

      const worktree = await page.evaluate(async () => {
        const state = window.__store!.getState()
        const repoId = Object.values(state.worktreesByRepo).flat()[0]!.repoId
        const created = (await state.createWorktree(repoId, 'offline-feed')).worktree
        return { id: created.id, path: created.path }
      })
      const worktreeId = worktree.id
      // The agent's work: a commit ahead of main, which is what offers the pull request.
      expect(worktree.path.startsWith(process.cwd()), 'commit only inside the seeded repo').toBe(
        false
      )
      appendFileSync(join(worktree.path, 'README.md'), '\nThe feed reads offline.\n')
      execFileSync('git', ['-C', worktree.path, 'commit', '-qam', 'Cache the feed offline'], {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Lumen',
          GIT_AUTHOR_EMAIL: 'team@example.com',
          GIT_COMMITTER_NAME: 'Lumen',
          GIT_COMMITTER_EMAIL: 'team@example.com'
        }
      })
      await seedAgentStatus(page, worktreeId, 'Cache the feed so it reads offline')
      const row = page.locator('[data-worktree-card-surface]', { hasText: 'offline-feed' }).first()
      await expect(row).toBeVisible()
      await expect.soft(row.locator('[data-status-tone="info"]').first()).toBeVisible()
      await captureBothThemes(page, testInfo, 'agent-working', fromLeftEdge(row))

      await seedPullRequestForm(page, worktreeId, 'offline-feed')
      await page.getByRole('button', { name: /Source Control/ }).click()
      const title = page.getByRole('textbox', { name: 'Pull request title' })
      await expect(title).toBeVisible({ timeout: 10_000 })
      await expect.soft(page.getByText('New pull request').first()).toBeVisible()
      await expect.soft(page.getByText('No changes on this branch')).toHaveCount(0)
      await expect
        .soft(page.getByRole('combobox', { name: 'Pull request base branch' }))
        .toHaveValue('main')
      const create = page.getByRole('button', { name: 'Create PR' }).last()
      await expect.soft(create).toBeVisible()
      await captureBothThemes(page, testInfo, 'create-pr', async () => {
        const top = (await title.boundingBox())!
        const bottom = (await create.boundingBox())!
        const x = Math.max(0, top.x - 24)
        return { x, y: 0, width: WINDOW.width - x, height: bottom.y + bottom.height + 24 }
      })
    } finally {
      rmSync(repo === DOCS_REPO ? dirname(DOCS_REPO) : repo, { recursive: true, force: true })
    }
  })
})

test.describe('Install: accounts', () => {
  test.use({ seedTestRepo: false })

  test('the accounts pane offers Add Account and Add with token beside System default', async ({
    electronApp,
    orcaPage: page
  }, testInfo) => {
    test.setTimeout(120_000)
    await waitForSessionReady(page)
    // Why 940: the pane then lays out within the docs column (560px), so 12px text stays 12px.
    await setWindowSize(electronApp, page, { width: 940, height: 1000 })
    await page.evaluate(() => {
      const state = window.__store!.getState()
      state.openSettingsTarget({ pane: 'accounts', repoId: null })
      state.openSettingsPage()
    })
    await expect(page.getByText('AI Provider Accounts').first()).toBeVisible({ timeout: 15_000 })
    // The install page's claim: an existing login needs no setup.
    await expect
      .soft(page.getByText(/Orca Lab works with your existing provider logins/).first())
      .toBeVisible()
    const claude = page.getByText('Claude', { exact: true }).first()
    await expect(claude).toBeVisible()
    const addAccount = page.getByRole('button', { name: 'Add Account' }).first()
    await expect(addAccount).toBeVisible()
    await expect.soft(page.getByRole('button', { name: 'Add with token' })).toBeVisible()
    await expect.soft(page.getByText('System default', { exact: true }).first()).toBeVisible()
    const empty = page.getByText(/No managed Claude accounts/).first()
    await expect(empty).toBeVisible()
    // The docs show this capture at 1:1 at most, so the app's own size is the floor on the page.
    const descriptionPx = await page
      .getByText(/Showing accounts for this device/)
      .first()
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    testInfo.annotations.push({ type: 'description-font-px', description: String(descriptionPx) })
    expect.soft(descriptionPx).toBeGreaterThanOrEqual(12)
    // The Claude section: its heading and buttons down to the empty-list note.
    await captureBothThemes(page, testInfo, 'accounts', async () => {
      const head = (await claude.boundingBox())!
      const end = (await empty.boundingBox())!
      // Why 8: the text box starts at the Claude mark; 8px keeps the card's border out.
      const x = head.x - 8
      const y = head.y - 16
      return { x, y, width: end.x + end.width + 8 - x, height: end.y + end.height + 4 - y }
    })
  })
})

test.describe('Projects: a folder, the sidebar and the new-tab menu', () => {
  test.use({ seedTestRepo: false })

  test('Open as Folder, the Lumen worktrees in the sidebar and the New tab menu', async ({
    electronApp,
    orcaPage: page
  }, testInfo) => {
    test.setTimeout(180_000)
    await waitForSessionReady(page)
    await setWindowSize(electronApp, page)
    const repo = docsRepo()
    try {
      await attachRepoAndOpenTerminal(page, repo)

      // The dialog only reads this path; nothing is created there.
      await page.evaluate(
        (folderPath) => {
          window.__store!.getState().openModal('confirm-non-git-folder', { folderPath })
        },
        `${dirname(DOCS_REPO)}/field-notes`
      )
      const folder = page.getByRole('dialog', { name: 'Open as Folder' })
      await expect(folder).toBeVisible()
      await expect.soft(folder.getByText(/isn't a Git repository/)).toBeVisible()
      await expect.soft(folder.getByRole('button', { name: 'Open as Folder' })).toBeVisible()
      await captureBothThemes(page, testInfo, 'open-as-folder', folder)
      await folder.getByRole('button', { name: 'Cancel' }).click()
      await expect(folder).toBeHidden()

      const ids = await page.evaluate(async () => {
        const state = window.__store!.getState()
        const repoId = Object.values(state.worktreesByRepo).flat()[0]!.repoId
        const made: string[] = []
        for (const name of ['offline-feed', 'search-filters']) {
          made.push((await state.createWorktree(repoId, name)).worktree.id)
        }
        return made
      })
      await seedAgentStatus(page, ids[0]!, 'Cache the feed so it reads offline')
      const rows = page.locator('[data-worktree-card-surface]')
      await expect(rows.filter({ hasText: 'search-filters' }).first()).toBeVisible()
      // One host: no host row, the projects sit straight under Projects.
      await expect.soft(page.getByText('Projects', { exact: true }).first()).toBeVisible()
      await captureBothThemes(page, testInfo, 'sidebar', fromLeftEdge(rows.last()))

      // Why: the same as Keep on the emulator tip, which would sit mid-menu in the capture.
      await page.evaluate(() => window.__store!.getState().dismissMobileEmulatorTabIntro())
      const plus = page.getByRole('button', { name: 'New tab' }).first()
      await plus.click()
      const menu = page.getByRole('menu')
      await expect(menu.getByRole('menuitem', { name: /New Terminal/ }).first()).toBeVisible()
      await expect.soft(menu.getByRole('menuitem', { name: /New Browser Tab/ })).toBeVisible()
      await expect.soft(menu.getByText(/Preview iOS simulators/)).toHaveCount(0)
      await captureBothThemes(page, testInfo, 'new-tab-menu', async () => {
        const button = (await plus.boundingBox())!
        const list = (await menu.boundingBox())!
        // Why 1: left of the menu's border is the pane behind it, with its own text.
        const x = list.x - 1
        const y = button.y - 8
        const right = Math.max(button.x + button.width, list.x + list.width) + 12
        return { x, y, width: right - x, height: list.y + list.height + 12 - y }
      })
      await page.keyboard.press('Escape')
    } finally {
      rmSync(repo === DOCS_REPO ? dirname(DOCS_REPO) : repo, { recursive: true, force: true })
    }
  })
})

test.describe('One agent: its state, the checks and the merge', () => {
  test.use({ seedTestRepo: false })

  test('agent states in the sidebar, a failing check with Fix, and Squash and merge', async ({
    electronApp,
    orcaPage: page
  }, testInfo) => {
    test.setTimeout(180_000)
    await waitForSessionReady(page)
    await setWindowSize(electronApp, page)
    const repo = docsRepo()
    try {
      await attachRepoAndOpenTerminal(page, repo)
      const agents = [
        { name: 'offline-feed', state: 'working', prompt: 'Cache the feed so it reads offline' },
        { name: 'search-filters', state: 'waiting', prompt: 'Which filters should stay visible?' },
        { name: 'dark-mode', state: 'done', prompt: 'Add a dark theme to the reader' }
      ] as const
      const ids = await page.evaluate(
        async (names) => {
          const state = window.__store!.getState()
          const repoId = Object.values(state.worktreesByRepo).flat()[0]!.repoId
          const made: Record<string, { id: string; path: string }> = {}
          for (const name of names) {
            const { worktree } = await state.createWorktree(repoId, name)
            made[name] = { id: worktree.id, path: worktree.path }
          }
          return made
        },
        agents.map((agent) => agent.name)
      )
      for (const agent of agents) {
        await seedAgentStatus(page, ids[agent.name]!.id, agent.prompt, agent.state)
      }
      const rows = page.locator('[data-worktree-card-surface]')
      for (const tone of ['info', 'attention', 'success']) {
        await expect.soft(rows.locator(`[data-status-tone="${tone}"]`).first()).toBeVisible()
      }
      await captureBothThemes(page, testInfo, 'agent-states', fromLeftEdge(rows.last()))

      const feed = ids['offline-feed']!
      expect(feed.path.startsWith(process.cwd()), 'commit only inside the seeded repo').toBe(false)
      appendFileSync(join(feed.path, 'README.md'), '\nThe feed reads offline.\n')
      execFileSync('git', ['-C', feed.path, 'commit', '-qam', 'Cache the feed offline'], {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Lumen',
          GIT_AUTHOR_EMAIL: 'team@example.com',
          GIT_COMMITTER_NAME: 'Lumen',
          GIT_COMMITTER_EMAIL: 'team@example.com'
        }
      })
      await seedOpenPullRequest(page, feed.id, 'offline-feed', {
        conclusion: 'failure',
        mergeStateStatus: 'BLOCKED'
      })
      const fix = page.getByRole('button', { name: 'Fix', exact: true })
      await expect(fix).toBeVisible({ timeout: 15_000 })
      await expect.soft(page.getByText(/1 failing/).first()).toBeVisible()
      const blocked = page.getByRole('button', { name: /^Blocked$/ })
      await expect.soft(blocked).toBeVisible()
      const title = page.getByText('Cache the feed so it reads offline', { exact: true }).last()
      await captureBothThemes(page, testInfo, 'checks-failing', async () => {
        const top = (await title.boundingBox())!
        const end = (await fix.boundingBox())!
        // Why 12 and 48: inside the panel's left border and below the activity bar's tab mark.
        const x = top.x - 12
        const y = Math.max(0, top.y - 48)
        return { x, y, width: WINDOW.width - x, height: end.y + end.height + 16 - y }
      })

      await seedOpenPullRequest(page, feed.id, 'offline-feed', {
        conclusion: 'success',
        mergeStateStatus: 'CLEAN'
      })
      await page.getByRole('button', { name: 'Refresh' }).first().click()
      const merge = page.getByRole('button', { name: /^Squash and merge$/ })
      await expect(merge).toBeVisible({ timeout: 15_000 })
      await expect.soft(page.getByText(/3 passing/).first()).toBeVisible()
      await captureBothThemes(page, testInfo, 'merge', async () => {
        const top = (await title.boundingBox())!
        const end = (await merge.boundingBox())!
        // Why 12 and 48: inside the panel's left border and below the activity bar's tab mark.
        const x = top.x - 12
        const y = Math.max(0, top.y - 48)
        return { x, y, width: WINDOW.width - x, height: end.y + end.height + 16 - y }
      })
    } finally {
      rmSync(repo === DOCS_REPO ? dirname(DOCS_REPO) : repo, { recursive: true, force: true })
    }
  })
})

test.describe('Trackers: connecting Plane', () => {
  test.use({ seedTestRepo: false })

  test('Task providers offers Linear, Jira and Plane, and Connect Plane asks for three fields', async ({
    electronApp,
    orcaPage: page
  }, testInfo) => {
    test.setTimeout(120_000)
    await waitForSessionReady(page)
    // Why 900x1000: the window the shipped capture was taken in.
    await setWindowSize(electronApp, page, { width: 900, height: 1000 })
    await page.evaluate(() => {
      const state = window.__store!.getState()
      state.openSettingsTarget({ pane: 'integrations', repoId: null })
      state.openSettingsPage()
    })
    const heading = page.getByRole('heading', { name: 'Task providers' })
    await expect(heading).toBeVisible({ timeout: 15_000 })
    await expect.soft(page.getByText('Review providers').first()).toBeVisible()
    // Why the nearest section: the outer Integrations section also contains this heading.
    const section = heading.locator('xpath=ancestor::section[1]')
    for (const name of ['Add Linear access', 'Connect Jira', 'Connect Plane']) {
      await expect.soft(section.getByRole('button', { name }).first()).toBeVisible()
    }

    // The dialog only: its fields carry placeholders, nothing is typed or sent.
    await section.getByRole('button', { name: 'Connect Plane' }).first().click()
    const plane = page.getByRole('dialog', { name: 'Connect Plane workspace' })
    await expect(plane).toBeVisible()
    for (const label of ['Plane base URL', 'Workspace slug', 'Personal access token']) {
      await expect.soft(plane.getByText(label, { exact: true }).first()).toBeVisible()
    }
    await captureBothThemes(page, testInfo, 'connect-plane', plane)
    await page.keyboard.press('Escape')
  })
})
