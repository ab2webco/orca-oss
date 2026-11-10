import { execSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { setTheme, THEMES, WIDTHS } from './helpers/settings-window'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'

// Why: one capture per tab, plugin state, width and theme outruns the CI budget; ORCA_CAPTURE_EVIDENCE=1 runs it.
const CAPTURE_EVIDENCE = process.env.ORCA_CAPTURE_EVIDENCE === '1'
const JEV_LINE = 'Keeps the lead on Opus for ORCA-1134'

// Why a fake gh: the merge queue is read through Orca's own GraphQL call, so only GitHub is stood in for.
const fakeGhDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-queue-gh-'))
const fakeGhBody = `#!/usr/bin/env node
const args = process.argv.slice(2)
const joined = args.join(' ')
const pr = (number, title) => ({ number, title, url: 'https://github.com/acme/repo/pull/' + number })
if (args[0] === '--version') {
  console.log('gh version 2.60.0 (2024-10-01)')
  process.exit(0)
}
if (args[0] === 'api' && joined.includes('rate_limit')) {
  const bucket = { limit: 5000, remaining: 5000, reset: 0 }
  console.log(JSON.stringify({ resources: { core: bucket, graphql: bucket, search: bucket } }))
  process.exit(0)
}
if (args[0] === 'api' && args.includes('graphql') && joined.includes('mergeQueue')) {
  const nodes = [
    { position: 1, state: 'AWAITING_CHECKS', enqueuedAt: new Date().toISOString(), pullRequest: pr(951, 'Launch E2E waits') },
    { position: 2, state: 'QUEUED', enqueuedAt: new Date().toISOString(), pullRequest: pr(952, 'Keep the reflow column') }
  ]
  console.log(JSON.stringify({ data: { repository: { mergeQueue: { entries: { nodes } } } } }))
  process.exit(0)
}
// Why no other answer: the PR and To Do lists may fail here; only the queue is under test.
console.error('fake gh: unhandled ' + joined)
process.exit(1)
`
const fakeGhPath = path.join(fakeGhDir, process.platform === 'win32' ? 'gh.cmd' : 'gh')
if (process.platform === 'win32') {
  writeFileSync(fakeGhPath, '@echo off\nnode "%~dp0\\fake-gh.js" %*\n')
  writeFileSync(path.join(fakeGhDir, 'fake-gh.js'), fakeGhBody)
} else {
  writeFileSync(fakeGhPath, fakeGhBody)
  chmodSync(fakeGhPath, 0o755)
}

test.use({ launchEnv: { PATH: `${fakeGhDir}${path.delimiter}${process.env.PATH ?? ''}` } })

test.afterAll(() => rmSync(fakeGhDir, { recursive: true, force: true }))

// The real lead's game.state, with no overlay: GitHub is the fake gh, the machine is this one.
test('PRs opens with the GitHub merge queue, Machines lists this machine alone, and Jev follows the plugin system', async ({
  electronApp,
  orcaPage,
  testRepoPath
}, testInfo) => {
  test.setTimeout(CAPTURE_EVIDENCE ? 900_000 : 300_000)
  // Why only origin: the seeded repo has no remote, and Orca reads the GitHub slug from it.
  execSync('git config remote.origin.url https://github.com/acme/repo.git', { cwd: testRepoPath })
  // Why: the repo is shared by the worker, and an orca.yaml with tracker: false turns the queue read off.
  expect(
    existsSync(path.join(testRepoPath, 'orca.yaml')),
    'an earlier spec in this worker left orca.yaml in the shared repo'
  ).toBe(false)
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
    await client.call('terminal.send', { terminal: lead, text: agent.command, enter: true })
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
    await emitCodexHookStatus(await readHookEndpoint(electronApp), {
      paneKey: pane.paneKey,
      worktreeId,
      state: 'working',
      prompt: 'Lead the team'
    })
    // The lead's Jev report, on the same game.state call its mod polls with.
    // Why the PATH each poll: Orca's login-shell PATH hydration puts the shell's own gh first.
    // Why so long: a queue read before then is cached for 90 s.
    let reported: OrchestratorGameState | null = null
    await expect
      .poll(
        async () => {
          await electronApp.evaluate(
            (_, { dir, sep }) => {
              const parts = (process.env.PATH ?? '').split(sep).filter((one) => one !== dir)
              process.env.PATH = [dir, ...parts].join(sep)
            },
            { dir: fakeGhDir, sep: path.delimiter }
          )
          const advisor = { version: 1, model: 'Opus 5.5', effort: 'high', line: JEV_LINE }
          reported = (
            await client.call<OrchestratorGameState>('game.state', {
              worktreeId,
              terminalHandle: lead,
              paneKey: pane.paneKey,
              advisor: { ...advisor, pinned: { model: false, effort: false } }
            })
          ).result
          return {
            jev: reported.agents.find((one) => one.isLeader)?.advisor?.line ?? null,
            queue: reported.project?.queue?.entries?.map((one) => one.id) ?? null
          }
        },
        { timeout: 150_000, intervals: [5_000], message: 'no Jev or queue in game.state' }
      )
      .toEqual({ jev: JEV_LINE, queue: ['#951', '#952'] })
    expect(reported!.localHost?.status, 'a lead alone publishes this machine').toBe('ok')

    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.updateSettings({ uiLanguage: 'en' })
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    await expect(panel.locator('[data-team-card="lead"]')).toBeVisible({ timeout: 60_000 })

    // Why PRs: V30 draws the merge queue at the top of PRs, with no Queue tab.
    await expect(panel.getByRole('tab', { name: 'Queue' })).toHaveCount(0)
    await panel.getByRole('tab', { name: 'PRs' }).click()
    await expect(panel.locator('[data-team-queue-title]')).toHaveText('Merge queue · 2', {
      timeout: 60_000
    })
    const first = panel.locator('[data-team-queue="#951"]')
    await expect(first).toContainText('Launch E2E waits', { timeout: 60_000 })
    await expect(first).toContainText('In checks')
    await expect(first).toHaveAttribute('href', 'https://github.com/acme/repo/pull/951')
    await expect(panel.locator('[data-team-queue="#952"]')).toContainText('In queue')

    await panel.getByRole('tab', { name: 'Machines' }).click()
    const local = panel.locator('[data-team-machine="local"]')
    await expect(local).toBeVisible()
    await expect(local.getByRole('img', { name: /^Memory used \d+%$/ })).toBeVisible()
    await expect(local).toContainText(/GB free/)
    await expect(panel).toContainText('Only this machine')
    await expect(panel).toContainText('Pair another machine to spread agents across hosts.')
    await expect(panel).not.toContainText('Could not read the machines')
    await expect(panel).not.toContainText('does not publish it yet')

    const advisor = panel.locator('[data-team-card="advisor"]')
    const capture = async (plugins: 'off' | 'on'): Promise<void> => {
      if (!CAPTURE_EVIDENCE) {
        return
      }
      for (const tab of ['Team', 'PRs', 'Machines']) {
        await panel.getByRole('tab', { name: tab }).click()
        await orcaPage.mouse.move(0, 0)
        for (const width of WIDTHS) {
          await orcaPage.setViewportSize({ width, height: 900 })
          for (const theme of THEMES) {
            await setTheme(orcaPage, theme)
            const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth)
            expect(overflow, `${tab} ${width} ${theme} overflows`).toBeLessThanOrEqual(0)
            await panel.screenshot({
              animations: 'disabled',
              path: testInfo.outputPath(`plugins-${plugins}-${tab}-${width}-${theme}.png`)
            })
          }
        }
      }
      await orcaPage.setViewportSize({ width: 1440, height: 900 })
    }

    // Plugins off: the report reached the host, and the panel still draws no Jev row.
    await panel.getByRole('tab', { name: 'Team' }).click()
    // Why through another tab: the panel re-reads on mount, far sooner than its 20 s poll.
    await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarTab('explorer'))
    await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarTab('team'))
    await expect(panel.locator('[data-team-card="lead"]')).toBeVisible({ timeout: 30_000 })
    await expect(advisor).toHaveCount(0)
    await capture('off')

    const plugins = (on: boolean): Promise<unknown> =>
      orcaPage.evaluate(
        (next) => window.__store!.getState().updateSettings({ pluginSystemEnabled: next }),
        on
      )
    await plugins(true)
    await panel.getByRole('tab', { name: 'Team' }).click()
    await expect(advisor).toContainText(JEV_LINE, { timeout: 30_000 })
    await capture('on')

    await plugins(false)
    await expect(advisor).toHaveCount(0, { timeout: 30_000 })
  } finally {
    agent.dispose()
  }
})
