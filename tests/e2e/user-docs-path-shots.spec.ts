/**
 * Invariant: every control the zero-to-expert docs name (docs/user, ORCA-1178) is on screen where
 * the page says, in the words it uses. Each step also saves its capture in light and dark for the
 * docs; the fictitious Lumen repo stands in for a real one. ORCA_DOCS_CAPTURE=1 on macOS puts it at
 * a fixed fictitious path, so the Run on row shows no temp folder.
 */

import { execFileSync } from 'node:child_process'
import { appendFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { attachRepoAndOpenTerminal } from './helpers/orca-restart'
import { demoMember } from './helpers/game-showcase-demo-party'
import { seedRendererGameState } from './helpers/game-state-renderer-seed'
import { DOCS_HOSTS } from './helpers/user-docs-hosts'
import { openTeamPanelWithLead } from './helpers/team-panel-lead'
import { RuntimeClient } from '../../src/cli/runtime-client'
import { waitForSessionReady } from './helpers/store'
import {
  DOCS_REPO,
  WINDOW,
  captureBothThemes,
  docsRepo,
  fromLeftEdge,
  setWindowSize
} from './helpers/user-docs-capture'
import {
  seedAgentStatus,
  seedOpenPullRequest,
  seedPullRequestForm
} from './helpers/user-docs-review-seeds'

const ONBOARDING_ADVANCE = /^Continue\b|^Add your first project\b/
const OPTIONAL_STEPS = [/Set up GitHub tasks|Connect your task sources/i, /Set Windows terminal/i]

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

test.describe('Agent Teams: the Team panel and the Inbox', () => {
  test.use({ seedTestRepo: false })

  test('a lead with three Lumen members, and a question for you in the Inbox', async ({
    electronApp,
    orcaPage: page
  }, testInfo) => {
    test.setTimeout(240_000)
    await waitForSessionReady(page)
    await setWindowSize(electronApp, page)
    const repo = docsRepo()
    try {
      await attachRepoAndOpenTerminal(page, repo)
      const { worktreeId } = await openTeamPanelWithLead(electronApp, page)
      // Why no account: the demo party's account field is an email, which no capture may show.
      await seedRendererGameState(electronApp, {
        agents: [
          demoMember({
            name: 'Pico',
            ticket: 'LUM-14',
            title: 'Offline cache for the feed',
            state: 'waiting',
            pr: { number: 42, ci: 'success', state: 'open' }
          }),
          demoMember({
            name: 'Juno',
            ticket: 'LUM-17',
            title: 'Share sheet on Android',
            state: 'working',
            tool: 'Edit'
          }),
          demoMember({
            name: 'Vega',
            ticket: 'LUM-21',
            title: 'Dark theme for the reader',
            state: 'working',
            tool: 'Bash',
            pr: { number: 44, ci: 'pending', state: 'open' }
          })
        ]
      })
      // Why: the panel re-reads game.state on this event at once, not at its next poll.
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) =>
          w.webContents.send('runtime:gameAdvisorChanged')
        )
      )
      const panel = page.getByTestId('team-panel')
      const members = panel.locator('[data-team-card="member"]')
      await expect(members).toHaveCount(3, { timeout: 30_000 })
      await expect.soft(panel.locator('[data-team-card="lead"]')).toBeVisible()
      await expect.soft(panel.getByText(/^Lv \d+$/).first()).toBeVisible()
      // A waiting member with no Inbox question is at a permission prompt in its own terminal.
      await expect.soft(panel.getByText('Permission prompt in its terminal').first()).toBeVisible()
      await expect.soft(panel.getByRole('button', { name: 'Answer in its terminal' })).toBeVisible()
      const panelBox = async () => (await panel.boundingBox())!
      testInfo.annotations.push({
        type: 'panel-css-px',
        description: String((await panelBox()).width)
      })
      expect.soft((await panelBox()).width).toBeLessThanOrEqual(560)
      await captureBothThemes(page, testInfo, 'team-tab', async () => {
        const box = await panelBox()
        const last = (await members.last().boundingBox())!
        return { x: box.x, y: box.y, width: box.width, height: last.y + last.height + 8 - box.y }
      })

      const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
      const client = new RuntimeClient(userDataDir, 30_000, null, null)
      await client.call('game.ownerAsk', {
        worktreeId,
        ticket: 'LUM-14',
        question: 'The offline cache needs 40 MB on older phones. Ship it in 2.3 or wait for 2.4?',
        options: ['Ship in 2.3', 'Wait for 2.4'],
        context: 'PR #42 has both builds.'
      })
      const inboxTab = panel.getByRole('tab', { name: /Inbox/ })
      await inboxTab.click()
      await expect(inboxTab).toHaveAttribute('aria-selected', 'true')
      const asked = panel.locator('[data-team-inbox-project="active"]')
      await expect(asked.getByText(/Ship it in 2\.3/)).toBeVisible({ timeout: 15_000 })
      // Each sub-tab carries its count in the same element: "For you 1".
      for (const label of ['For you', 'Waiting', 'Threads', 'Answered']) {
        await expect.soft(panel.getByText(new RegExp(`^${label}\\s*\\d+$`)).first()).toBeVisible()
      }
      await expect.soft(asked.getByRole('button', { name: 'Ship in 2.3' })).toBeVisible()
      await captureBothThemes(page, testInfo, 'inbox', async () => {
        const box = await panelBox()
        const end = (await asked.boundingBox())!
        return { x: box.x, y: box.y, width: box.width, height: end.y + end.height + 12 - box.y }
      })

      // Made-up hosts only: no capture may show a real machine, user or address.
      await seedRendererGameState(electronApp, { state: { hostCapacity: DOCS_HOSTS } })
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) =>
          w.webContents.send('runtime:gameAdvisorChanged')
        )
      )
      await panel.getByRole('tab', { name: /^(Machines|Hosts)/ }).click()
      const host = (name: string) => panel.locator(`[data-team-machine="${name}"]`)
      const figure = (name: string) => panel.locator(`[data-team-machines-figure="${name}"]`)
      await expect(host('nas-02')).toBeVisible({ timeout: 30_000 })
      await expect.soft(host('local')).toContainText('This computer')
      await expect
        .soft(host('buildbox'), 'a busy host starts open')
        .toHaveAttribute('data-state', 'open')
      await expect.soft(host('atelier')).toContainText('Not registered')
      await expect.soft(host('nas-02')).toContainText('Offline')
      await expect.soft(figure('ready')).toContainText('3 of 5')
      await expect.soft(figure('agents')).toContainText('3 of 15')
      await expect.soft(figure('warned')).toContainText('buildbox')
      // Why 1000: under the scene banner, five hosts run past an 800px window.
      await setWindowSize(electronApp, page, { width: 1280, height: 1000 })
      await page.mouse.move(0, 0)
      await captureBothThemes(page, testInfo, 'machines', async () => {
        const box = await panelBox()
        const end = (await host('nas-02').boundingBox())!
        // Why hard: a board taller than the window would be captured cut.
        expect(end.y + end.height).toBeLessThan(1000)
        return { x: box.x, y: box.y, width: box.width, height: end.y + end.height + 4 - box.y }
      })
    } finally {
      rmSync(repo === DOCS_REPO ? dirname(DOCS_REPO) : repo, { recursive: true, force: true })
    }
  })
})

test.describe('Scenes and settings: the Panel group', () => {
  test.use({ seedTestRepo: false })

  test('Settings > Agents > Panel holds the scene, look, style, preview and tab switches', async ({
    electronApp,
    orcaPage: page
  }, testInfo) => {
    test.setTimeout(120_000)
    await waitForSessionReady(page)
    // Why 900: the pane is the window less the settings nav, so the group fits the 560px column.
    await setWindowSize(electronApp, page, { width: 900, height: 1000 })
    await page.evaluate(() => {
      const state = window.__store!.getState()
      state.openSettingsTarget({ pane: 'agents', repoId: null, sectionId: 'agents-game-panel' })
      state.openSettingsPage()
    })
    const group = page.locator('#agents-game-panel')
    await expect(group).toBeVisible({ timeout: 15_000 })
    for (const label of ['Scene', 'Panel look', 'Scene style', 'PRs', 'Queue', 'Machines']) {
      await expect.soft(group.getByText(label, { exact: true }).first()).toBeVisible()
    }
    // A new profile starts on the defaults the page names: Game, Pixel and the Quest scene.
    await expect.soft(group.getByRole('radio', { name: 'Game' })).toBeChecked()
    await expect.soft(group.getByRole('radio', { name: 'Pixel' })).toBeChecked()
    const box = (await group.boundingBox())!
    testInfo.annotations.push({
      type: 'panel-group-css-px',
      description: `${box.width}x${box.height}`
    })
    expect.soft(box.width).toBeLessThanOrEqual(560)
    // Why: past the window's height an element capture comes out blank (PR 6's first try).
    expect(box.height).toBeLessThan(900)
    await captureBothThemes(page, testInfo, 'panel-settings', group)
  })
})

test.describe('Hosts: pairing and SSH in Settings', () => {
  test.use({ seedTestRepo: false })

  test('Remote Orca Lab Servers offers three ways in, and Add Target opens the Add SSH host dialog', async ({
    electronApp,
    orcaPage: page
  }, testInfo) => {
    test.setTimeout(120_000)
    await waitForSessionReady(page)
    // Why 900: the pane is the window less the settings nav, so each section fits the 560px column.
    await setWindowSize(electronApp, page, { width: 900, height: 1000 })
    const open = (pane: 'servers' | 'ssh') =>
      page.evaluate((target) => {
        const state = window.__store!.getState()
        state.openSettingsTarget({ pane: target, repoId: null, sectionId: target })
        state.openSettingsPage()
      }, pane)
    // Why: past the window's height an element capture comes out blank (PR 6's first try).
    const fits = async (name: string, section: ReturnType<typeof page.locator>) => {
      const box = (await section.boundingBox())!
      testInfo.annotations.push({
        type: `${name}-css-px`,
        description: `${box.width}x${box.height}`
      })
      expect.soft(box.width).toBeLessThanOrEqual(560)
      expect(box.height).toBeLessThan(900)
    }

    await open('servers')
    const servers = page.locator('section#servers')
    await expect(servers).toBeVisible({ timeout: 15_000 })
    for (const name of ['Connect to a host', 'Share this host']) {
      await expect.soft(servers.getByText(name, { exact: true }).first()).toBeVisible()
    }
    await fits('remote-servers', servers)
    await captureBothThemes(page, testInfo, 'remote-servers', servers)

    await open('ssh')
    const ssh = page.locator('section#ssh')
    await expect(ssh).toBeVisible({ timeout: 15_000 })
    await expect.soft(ssh.getByRole('button', { name: 'Import' })).toBeVisible()
    await ssh.getByRole('button', { name: 'Add Target' }).click()
    // Add Target opens a modal outside the section; the page names its fields, so no capture.
    const form = page.getByRole('dialog', { name: 'Add SSH host' })
    await expect(form).toBeVisible()
    for (const label of ['Host or alias *', 'Username', 'Port', 'Identity File', 'Advanced']) {
      await expect.soft(form.getByText(label, { exact: true }).first()).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await expect(form).toBeHidden()
  })
})

test.describe('Artifacts: the publishing settings', () => {
  test.use({ seedTestRepo: false })

  test('Settings > Artifacts is off by default and names its upload host', async ({
    electronApp,
    orcaPage: page
  }, testInfo) => {
    test.setTimeout(120_000)
    await waitForSessionReady(page)
    // Why 900: the pane is the window less the settings nav, so each capture fits the 560px column.
    await setWindowSize(electronApp, page, { width: 900, height: 1000 })
    const open = (pane: 'artifacts') =>
      page.evaluate((target) => {
        const state = window.__store!.getState()
        state.openSettingsTarget({ pane: target, repoId: null, sectionId: target })
        state.openSettingsPage()
      }, pane)
    const fits = async (name: string, target: ReturnType<typeof page.locator>) => {
      const box = (await target.boundingBox())!
      testInfo.annotations.push({
        type: `${name}-css-px`,
        description: `${box.width}x${box.height}`
      })
      expect.soft(box.width).toBeLessThanOrEqual(560)
      expect(box.height).toBeLessThan(900)
    }

    await open('artifacts')
    const artifacts = page.locator('section#artifacts')
    await expect(artifacts).toBeVisible({ timeout: 15_000 })
    await expect
      .soft(artifacts.getByText('Allow publishing public artifact links').first())
      .toBeVisible()
    await expect.soft(artifacts.getByText(/share\.onorca\.dev/).first()).toBeVisible()
    await expect(artifacts.getByText(/\b\d{1,3}(\.\d{1,3}){3}\b/)).toHaveCount(0)
    await fits('artifacts-settings', artifacts)
    await captureBothThemes(page, testInfo, 'artifacts-settings', artifacts)
  })
})

test.describe('Plugins: the plugin system in Settings', () => {
  test.use({ seedTestRepo: false })

  test('Settings > Plugins starts with the plugin system off and Install plugin waiting', async ({
    electronApp,
    orcaPage: page
  }, testInfo) => {
    test.setTimeout(120_000)
    await waitForSessionReady(page)
    // Why 900: the pane is the window less the settings nav, so the section fits the 560px column.
    await setWindowSize(electronApp, page, { width: 900, height: 1000 })
    await page.evaluate(() => {
      const state = window.__store!.getState()
      state.openSettingsTarget({ pane: 'plugins', repoId: null, sectionId: 'plugins' })
      state.openSettingsPage()
    })
    const plugins = page.locator('section#plugins')
    await expect(plugins).toBeVisible({ timeout: 15_000 })
    await expect.soft(plugins.getByText('Plugin system', { exact: true }).first()).toBeVisible()
    // The page's claim: off by default, and nothing installs until it is on.
    await expect.soft(plugins.getByRole('switch').first()).not.toBeChecked()
    await expect.soft(plugins.getByRole('button', { name: 'Install plugin' })).toBeDisabled()
    const box = (await plugins.boundingBox())!
    testInfo.annotations.push({ type: 'plugins-css-px', description: `${box.width}x${box.height}` })
    expect.soft(box.width).toBeLessThanOrEqual(560)
    // Why: past the window's height an element capture comes out blank (PR 6's first try).
    expect(box.height).toBeLessThan(900)
    await captureBothThemes(page, testInfo, 'plugin-system', plugins)
  })
})

test.describe('Troubleshooting: a stuck terminal', () => {
  test.use({ seedTestRepo: false })

  test('Settings > Terminal > Manage Sessions offers Restart daemon and Kill all sessions', async ({
    electronApp,
    orcaPage: page
  }, testInfo) => {
    test.setTimeout(120_000)
    await waitForSessionReady(page)
    // Why 900: the pane is the window less the settings nav, so the block fits the 560px column.
    await setWindowSize(electronApp, page, { width: 900, height: 1000 })
    await page.evaluate(() => {
      const state = window.__store!.getState()
      state.openSettingsTarget({
        pane: 'terminal',
        repoId: null,
        sectionId: 'terminal-manage-sessions'
      })
      state.openSettingsPage()
    })
    const sessions = page.locator('#terminal-manage-sessions')
    await expect(sessions).toBeVisible({ timeout: 15_000 })
    for (const name of ['Restart daemon', 'Kill all sessions']) {
      await expect.soft(sessions.getByRole('button', { name }).first()).toBeVisible()
    }
    // Why hard: a listed session carries a real working directory, which no capture may show.
    await expect(sessions.getByText('No sessions.')).toBeVisible({ timeout: 10_000 })
    await expect(sessions.getByText(/\/Users\/|\/home\/|[A-Z]:\\/)).toHaveCount(0)
    const box = (await sessions.boundingBox())!
    testInfo.annotations.push({
      type: 'sessions-css-px',
      description: `${box.width}x${box.height}`
    })
    expect.soft(box.width).toBeLessThanOrEqual(560)
    expect(box.height).toBeLessThan(900)
    await captureBothThemes(page, testInfo, 'manage-sessions', sessions)
  })
})
