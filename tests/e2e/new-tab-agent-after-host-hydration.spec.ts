/**
 * Invariant: a New tab > Claude opened while the repo's host is still unknown, as during a slow
 * start, runs the agent once the host loads, instead of leaving a plain shell (ORCA-1189).
 * Needs E2E: the parked pane, the repos:changed remount and the PTY spawn only happen in the app.
 */

import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { focusActiveTerminalInput, waitForTerminalOutput } from './helpers/terminal'
import { getGoldenStubAgentLaunchEnv, GOLDEN_STUB_READY_MARKER } from './helpers/golden-stub-agent'

/** Puts a `claude` shim for the golden stub first on PATH; the New tab menu lists only found agents. */
function claudeStubEnv(): Record<string, string> {
  const shimDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-claude-shim-'))
  const stub = path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'golden-stub-agent')
  writeFileSync(path.join(shimDir, 'claude'), `#!/bin/sh\nexec "${stub}/golden-stub-agent" "$@"\n`)
  chmodSync(path.join(shimDir, 'claude'), 0o755)
  writeFileSync(
    path.join(shimDir, 'claude.cmd'),
    `@echo off\r\ncall "${stub}\\golden-stub-agent.cmd" %*\r\n`
  )
  const env = getGoldenStubAgentLaunchEnv() as Record<string, string>
  const pathKey = Object.keys(env)[0]!
  return { [pathKey]: [shimDir, env[pathKey]].join(path.delimiter) }
}

test.use({ orcaAppExtraEnv: claudeStubEnv() })

test('a Claude tab opened while the repo host is unknown runs the agent once the host loads', async ({
  electronApp,
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await orcaPage.evaluate(async () => {
    await window.__store!.getState().updateSettings({
      defaultTuiAgent: 'claude',
      agentCmdOverrides: { claude: 'golden-stub-agent' },
      agentDefaultArgs: { claude: '' }
    })
  })
  // Why the store and not the menu: agent detection is host-scoped, so the menu drops Claude while
  // the host is unknown; these are the calls its Claude item makes (launch-agent-in-new-tab.ts).
  const tabId = await orcaPage.evaluate((id) => {
    const store = window.__store!
    const state = store.getState()
    const repoId = id.split('::')[0]
    // Why: with no repo row and no stamped host the worktree's owner is unknown, as in a slow start.
    store.setState({
      repos: state.repos.filter((repo) => repo.id !== repoId),
      worktreesByRepo: Object.fromEntries(
        Object.entries(state.worktreesByRepo).map(([key, list]) => [
          key,
          list.map((worktree) =>
            worktree.id === id ? { ...worktree, hostId: undefined } : worktree
          )
        ])
      )
    })
    const tab = store.getState().createTab(id, undefined, undefined, { launchAgent: 'claude' })
    store.getState().queueTabStartupCommand(tab.id, { command: 'claude', launchAgent: 'claude' })
    store.getState().setActiveTab(tab.id)
    return tab.id
  }, worktreeId)
  // The pane parks: it spawns nothing while the host is unknown.
  await orcaPage.waitForTimeout(1_000)
  expect(
    await orcaPage.evaluate(
      (tab) => window.__store!.getState().ptyIdsByTabId[tab]?.length ?? 0,
      tabId
    ),
    'the tab spawned a PTY while its host was unknown, so it never parked'
  ).toBe(0)
  const generation = () =>
    orcaPage.evaluate(
      ([wt, tab]) =>
        window.__store!.getState().tabsByWorktree[wt]?.find((one) => one.id === tab)?.generation ??
        0,
      [worktreeId, tabId] as const
    )
  const parkedGeneration = await generation()

  // The host loads: main announces the repos, which re-reads them and remounts parked panes.
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('repos:changed')
  })
  await expect
    .poll(generation, { message: 'the parked tab was never remounted' })
    .toBeGreaterThan(parkedGeneration)

  await focusActiveTerminalInput(orcaPage)
  await waitForTerminalOutput(orcaPage, GOLDEN_STUB_READY_MARKER, 30_000)
})
