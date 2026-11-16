import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import {
  launchHeadlessPairedRuntimeHost,
  type HeadlessPairedRuntimeHost
} from './helpers/headless-paired-runtime-host'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  getTerminalContent,
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId
} from './helpers/terminal'
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

/** Words of a wrapped value whose letters land on two lines: the value broke inside a word. */
function wordsSplitAcrossLines(value: Locator): Promise<string[]> {
  return value.evaluate((node) => {
    const split: string[] = []
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const content = text.textContent ?? ''
      const words = /\S+/g
      for (let word = words.exec(content); word; word = words.exec(content)) {
        const range = document.createRange()
        range.setStart(text, word.index)
        range.setEnd(text, word.index + word[0].length)
        const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)))
        if (lines.size > 1) {
          split.push(word[0])
        }
      }
    }
    return split
  })
}

/** Whether the active terminal shows this machine's user or host name, and a prompt at all. */
async function namesInTerminal(page: Page): Promise<{ named: boolean; prompt: boolean }> {
  const shown = await getTerminalContent(page)
  const names = [os.userInfo().username, os.hostname().split('.')[0]]
  return { named: names.some((name) => shown.includes(name)), prompt: shown.includes('$') }
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
    await writeSettings(orcaPage, {
      uiLanguage: 'es',
      defaultTuiAgent: 'codex',
      agentCmdOverrides: { codex: agent.command },
      agentDefaultArgs: { codex: '' }
    })

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

    // Why a bare prompt: a capture must not show the person's user or machine name.
    if (process.platform !== 'win32') {
      await client.call('terminal.send', {
        terminal: lead,
        text: "PS1='$ '; printf '\\033c'",
        enter: true
      })
      await expect.poll(() => namesInTerminal(orcaPage)).toEqual({ named: false, prompt: true })
    }
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
        // ORCA-851: the lead's ticket-kind default crosses to the host and starts there unpinned.
        model: 'claude-opus-5-5',
        effort: 'high',
        modelChosenBy: { by: 'lead', kind: 'implement', source: 'flag' },
        timeoutMs: 60_000
      },
      { timeoutMs: 90_000 }
    )
    await expect
      .poll(() =>
        agent.readLaunches().find((one) => one.argv.some((arg) => arg.includes('claude-opus-5-5')))
      )
      .toMatchObject({ modelPinned: null, effortPinned: null })

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
    await expect(card.locator('[data-team-model]')).toHaveText('Opus 5.5 · high', {
      timeout: 60_000
    })
    await card.locator('button[aria-expanded]').first().click()
    await expect(card).toContainText('Elegido por el lead: implementación')
    // Why: this window lacks the host's repo, so the card says so instead of a failed reveal.
    await expect(card.locator('[data-team-card-host-hint]')).toHaveText(
      'Agrega el repositorio del host a esta ventana para abrir su terminal.'
    )
    if (process.platform !== 'win32') {
      expect(await namesInTerminal(orcaPage)).toEqual({ named: false, prompt: true })
    }

    const errorToast = orcaPage.locator('[data-sonner-toast][data-type="error"]')
    const choice = card.locator('[data-team-detail="modelChoice"] dd')
    for (const width of WIDTHS) {
      await orcaPage.setViewportSize({ width, height: 900 })
      expect
        .soft(await wordsSplitAcrossLines(choice), `a word breaks mid-word at ${width}px`)
        .toEqual([])
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth)
        expect(overflow, `panel overflows at ${width}px ${theme}`).toBeLessThanOrEqual(0)
        // Why: a capture must not show an error state over the panel.
        await expect.soft(errorToast, `error toast at ${width}px ${theme}`).toHaveCount(0)
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
