/**
 * An idle game lead that survives an Orca restart: a copied `sleep` named `claude` that never sends
 * a hook, registered with `game lead`. Shared by the ORCA-1130 restart specs.
 */

import { execFileSync, execSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, type Page } from '@stablyai/playwright-test'
import { ensureTerminalVisible, waitForSessionReady } from './store'
import { attachRepoAndOpenTerminal } from './orca-restart'
import { execInTerminal, waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './terminal'
import { RuntimeClient } from '../../../src/cli/runtime-client'
import type { AgentHookEndpoint } from '../../../src/shared/agent-hook-endpoint-file'

type StateLog = typeof globalThis & { __teamPanelStates?: string[] }

export type FakeClaude = { path: string; running: () => boolean; dispose: () => void }

export function createFakeClaude(): FakeClaude {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-idle-lead-'))
  const fake = path.join(dir, 'claude')
  copyFileSync(execFileSync('which', ['sleep'], { encoding: 'utf8' }).trim(), fake)
  chmodSync(fake, 0o755)
  if (process.platform === 'darwin') {
    // Why: macOS kills a copied system binary until it carries a signature of its own.
    execFileSync('codesign', ['--force', '-s', '-', fake], { stdio: 'ignore' })
  }
  return {
    path: fake,
    running: () => {
      try {
        return execSync(`pgrep -f ${JSON.stringify(dir)}`, { encoding: 'utf8' }).trim() !== ''
      } catch {
        return false
      }
    },
    dispose: () => rmSync(dir, { recursive: true, force: true })
  }
}

export type IdleLead = {
  paneKey: string
  worktreeId: string
  handle: string
  client: RuntimeClient
}

/** Opens the repo's terminal, runs the fake Claude in it and registers that pane as the lead. */
export async function startIdleLead(args: {
  page: Page
  userDataDir: string
  repoPath: string
  fake: FakeClaude
  project: string
}): Promise<IdleLead> {
  const { page } = args
  await attachRepoAndOpenTerminal(page, args.repoPath)
  await waitForSessionReady(page)
  await ensureTerminalVisible(page)
  const ptyId = await waitForActivePanePtyId(page)
  const { paneKey } = await waitForActivePaneHookDescriptor(page)
  const client = new RuntimeClient(args.userDataDir, 30_000, null, null)
  const handle = (
    await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', { paneKey })
  ).result.terminal.handle
  const { worktreeId } = (
    await client.call<{ terminal: { worktreeId: string } }>('terminal.show', { terminal: handle })
  ).result.terminal
  // Why: until the runtime knows the worktree, the lead has no project and is never kept.
  await expect
    .poll(async () =>
      (
        await client.call<{ worktrees: { id: string }[] }>('worktree.list', {})
      ).result.worktrees.some((one) => one.id === worktreeId)
    )
    .toBe(true)
  await execInTerminal(page, ptyId, `${JSON.stringify(args.fake.path)} 900`)
  await expect.poll(() => args.fake.running(), { timeout: 15_000 }).toBe(true)
  const registered = await client.call<{ registered: boolean }>('game.leadRegister', {
    terminalHandle: handle,
    project: args.project,
    label: 'Ana',
    claim: true
  })
  expect(registered.result).toEqual({ registered: true })
  return { paneKey, worktreeId, handle, client }
}

export async function openTeamPanel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store!.getState()
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('team')
  })
}

export async function expectTeamTabs(page: Page): Promise<void> {
  const panel = page.getByTestId('team-panel')
  for (const name of ['Team', 'PRs', 'Queue']) {
    await expect(panel.getByRole('tab', { name })).toBeVisible({ timeout: 30_000 })
  }
  await expect(panel).toHaveAttribute('data-team-panel-state', 'team')
}

// Why an observer: the no-team form can flash between loading and the team, and a poll misses it.
export async function recordPanelStates(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: string[] = []
    ;(globalThis as StateLog).__teamPanelStates = log
    const note = (): void => {
      const state = document
        .querySelector('[data-testid="team-panel"]')
        ?.getAttribute('data-team-panel-state')
      if (state && log.at(-1) !== state) {
        log.push(state)
      }
    }
    note()
    new MutationObserver(note).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-team-panel-state']
    })
  })
}

export async function readPanelStates(page: Page): Promise<string[]> {
  return page.evaluate(() => (globalThis as StateLog).__teamPanelStates ?? [])
}

/** One Claude hook event through the real /hook/claude server, as a pane's own hook sends it. */
export async function postClaudeHook(
  endpoint: AgentHookEndpoint,
  pane: { paneKey: string; worktreeId: string },
  payload: Record<string, unknown>
): Promise<void> {
  const [tabId] = pane.paneKey.split(':')
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/hook/claude`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Orca-Agent-Hook-Token': endpoint.token },
    body: JSON.stringify({
      paneKey: pane.paneKey,
      tabId,
      worktreeId: pane.worktreeId,
      env: endpoint.env,
      version: endpoint.version,
      payload
    })
  })
  expect(response.status).toBe(204)
}
