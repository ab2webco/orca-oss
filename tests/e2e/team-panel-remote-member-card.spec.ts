import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import {
  launchHeadlessPairedRuntimeHost,
  type HeadlessPairedRuntimeHost
} from './helpers/headless-paired-runtime-host'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'

const WIDTHS = [1440, 768, 390, 320]

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

function gitRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-remote-repo-'))
  writeFileSync(path.join(dir, 'README.md'), 'remote member\n')
  for (const args of [
    ['init', '-q', '-b', 'main'],
    ['add', '.'],
    ['-c', 'user.email=e2e@example.test', '-c', 'user.name=E2E', 'commit', '-qm', 'init']
  ]) {
    execFileSync('git', args, { cwd: dir })
  }
  return dir
}

// ORCA-1094 asks for the cards compared on a member that really runs on a paired host: here a
// headless Orca paired over the runtime wire, with the member started there by `workerStart --on`.
test('a member on a paired host gets its card, character, face and host name', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(600_000)
  const agent = createStdinLoggingAgent()
  let host: HeadlessPairedRuntimeHost | null = null
  const repo = gitRepo()
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
    await orcaPage.evaluate(async (command) => {
      await window.__store!.getState().updateSettings({
        uiLanguage: 'es',
        defaultTuiAgent: 'codex',
        agentCmdOverrides: { codex: command },
        agentDefaultArgs: { codex: '' }
      })
    }, agent.command)

    // Why seeded: a headless host has no settings IPC, and the wire refuses command overrides.
    host = await launchHeadlessPairedRuntimeHost({
      defaultTuiAgent: 'codex',
      agentCmdOverrides: { codex: agent.command },
      agentDefaultArgs: { codex: '' }
    })
    await host.client.call('repo.add', { path: repo })
    const pairingCode = host.offer.pairingUrl
    await orcaPage.evaluate(
      (code) =>
        window.api.runtimeEnvironments.addFromPairingCode({ name: 'imac', pairingCode: code }),
      pairingCode
    )

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
      worktreeId,
      state: 'working',
      prompt: 'Lead the team'
    })

    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Remote card',
      from: lead
    })
    const title = 'Herrero · ORCA-21 Remote look'
    const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: 'Work on ORCA-21',
      taskTitle: title,
      run: run.result.run.id,
      callerTerminalHandle: lead
    })
    await client.call(
      'orchestration.workerStart',
      {
        task: task.result.task.id,
        from: lead,
        on: 'imac',
        repo,
        worktree: 'new-top-level',
        name: 'orca-21',
        displayName: title,
        agent: 'codex',
        timeoutMs: 60_000
      },
      { timeoutMs: 90_000 }
    )

    await expect
      .poll(
        async () => {
          const state = (
            await client.call<OrchestratorGameState>('game.state', {
              worktreeId,
              terminalHandle: lead,
              paneKey: pane.paneKey
            })
          ).result
          return state.agents.find((one) => one.remote?.host === 'imac')?.displayName ?? null
        },
        { timeout: 120_000, message: 'game.state never listed the member on imac' }
      )
      .toContain('Herrero')

    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    const card = panel.locator('[data-team-card="member"]').filter({ hasText: 'ORCA-21' })
    await expect(card).toHaveCount(1, { timeout: 90_000 })
    await expect(card).toContainText('Herrero')
    await expect(card).not.toContainText('Remote look')
    await expect(card).toContainText('imac')
    await expect(card.locator('canvas[data-team-face]')).toHaveCount(1)

    for (const width of WIDTHS) {
      await orcaPage.setViewportSize({ width, height: 900 })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth)
        expect(overflow, `panel overflows at ${width}px ${theme}`).toBeLessThanOrEqual(0)
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`remote-card-${width}-${theme}.png`)
        })
      }
    }
  } finally {
    agent.dispose()
    await host?.dispose()
    rmSync(repo, { recursive: true, force: true })
  }
})
