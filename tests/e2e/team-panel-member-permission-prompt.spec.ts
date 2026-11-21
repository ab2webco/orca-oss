/**
 * ORCA-1231: a member's Bash permission prompt read "Waiting for your answer" and sent the person to an
 * empty Inbox, and once the prompt was cancelled the card kept waiting, since Claude fires no hook then.
 * A real member pane draws Claude 2.1.325's own dialog and gets its real hooks; Esc in that pane ends it.
 * ORCA-1205 rides along: a stopped member on red CI and a lead whose turn ended never read Done.
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { test as base, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { seededReview, seedRendererGameState } from './helpers/game-state-renderer-seed'
import { setTheme, setWindowWidth, THEMES, WIDTHS } from './helpers/settings-window'
import { writeSettings } from './helpers/settings-write'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

const FIXTURES = path.join(__dirname, '../../src/shared/__fixtures__/claude-permission-prompt')
// Why cut: the fixtures are 120 columns wide; a narrower pane must not wrap a dialog line in two.
const screenOf = (name: string): string =>
  readFileSync(path.join(FIXTURES, `${name}.txt`), 'utf8')
    .split('\n')
    .map((line) => line.slice(0, 60))
    .join('\n')
const HOOKS = JSON.parse(readFileSync(path.join(FIXTURES, 'hooks-until-prompt.json'), 'utf8')) as {
  hook_event_name: string
}[]
// Why gated: every width and theme is evidence for a reviewer, too slow for each CI run.
const CAPTURE = process.env.ORCA_E2E_CAPTURE === '1'

// Why a fake `codex` on PATH: a worker launched by name has its own stdout in terminal.read
// (orchestration-worker-stdout-read-visibility), which is what the lead's screen check reads.
const fakeCliDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-permission-prompt-'))
const keysPath = path.join(fakeCliDir, 'keys.log')
const fakeCodexSource = `
const { appendFileSync } = require('node:fs')
if (process.argv.slice(2).includes('app-server')) {
  process.stderr.write("error: unrecognized subcommand 'app-server'\\n")
  process.exit(2)
}
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
}
process.stdout.write('\\u001b]0;Codex Ready\\u0007OpenAI Codex\\nmodel: e2e\\ndirectory: e2e\\n')
let shown = false
// Why a lone Esc: Orca types its brief as a bracketed paste, which starts with an Esc too.
process.stdin.on('data', (chunk) => {
  const input = chunk.toString()
  appendFileSync(${JSON.stringify(keysPath)}, JSON.stringify(input) + '\\n')
  if (!shown && (input.includes('\\r') || input.includes('\\n'))) {
    shown = true
    process.stdout.write('\\n' + ${JSON.stringify(screenOf('dialog-pending'))} + '\\n')
  } else if (shown && input === '\\u001b') {
    process.stdout.write('\\n' + ${JSON.stringify(screenOf('after-esc'))} + '\\n')
  }
})
process.stdin.resume()
setInterval(() => {}, 60_000)
`
if (process.platform === 'win32') {
  writeFileSync(path.join(fakeCliDir, 'fake-codex.js'), fakeCodexSource)
  writeFileSync(
    path.join(fakeCliDir, 'codex.cmd'),
    '@echo off\r\nnode "%~dp0\\fake-codex.js" %*\r\n'
  )
} else {
  writeFileSync(path.join(fakeCliDir, 'codex'), `#!/usr/bin/env node\n${fakeCodexSource}`)
  chmodSync(path.join(fakeCliDir, 'codex'), 0o755)
}

const launchEnv: NodeJS.ProcessEnv = {
  PATH: `${fakeCliDir}${path.delimiter}${process.env.PATH ?? ''}`
}
const test = base.extend({ launchEnv })

test.afterAll(() => {
  rmSync(fakeCliDir, { recursive: true, force: true })
})

const readKeys = (): string =>
  existsSync(keysPath) ? readFileSync(keysPath, 'utf8').slice(-400) : ''

/** ORCA-1205's members, added to the real ones in game.state as a launch would report them. */
const withStoppedMembers = (app: ElectronApplication): Promise<void> =>
  seedRendererGameState(app, {
    agents: [
      {
        paneKey: 'seed:1198',
        displayName: 'Rosalina · ORCA-1198',
        agentType: 'claude',
        state: 'done',
        toolName: null,
        isLeader: false,
        isMember: true,
        review: seededReview(1205, 'open', 'failure')
      },
      {
        paneKey: 'seed:1195',
        displayName: 'Mario · ORCA-1195',
        agentType: 'claude',
        state: 'done',
        toolName: null,
        isLeader: false,
        isMember: true,
        review: seededReview(1195, 'merged', 'success')
      }
    ]
  })

async function capture(
  app: ElectronApplication,
  page: Page,
  target: Locator,
  name: string,
  testInfo: TestInfo,
  widths: readonly number[] = WIDTHS
): Promise<void> {
  if (!CAPTURE) {
    return
  }
  for (const width of widths) {
    await setWindowWidth(app, page, width)
    for (const theme of THEMES) {
      await setTheme(page, theme)
      await target.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(`${name}-${width}-${theme}.png`)
      })
    }
  }
  await setWindowWidth(app, page, 1440)
}

async function setLook(
  page: Page,
  look: 'plain' | 'game',
  style: 'office' | 'pixel' = 'office'
): Promise<void> {
  await page.evaluate(
    ({ look: nextLook, style: nextStyle }) => {
      const state = window.__store!.getState()
      const game = state.settings?.orchestratorGame
      void state.updateSettings({
        // Why Low resources: the 2D Office's cards and floors are what this spec reads.
        orchestratorGame: {
          ...game,
          panel: { ...game?.panel, look: nextLook, style: nextStyle, quality: 'low' }
        }
      })
    },
    { look, style }
  )
}

/** The panel re-reads game.state on this event at once, instead of at its next 20 s poll. */
const refreshTeam = (app: ElectronApplication): Promise<void> =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('runtime:gameAdvisorChanged'))
  )

test("a member's permission prompt opens its pane, and leaves its card once cancelled there", async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(CAPTURE ? 900_000 : 300_000)
  rmSync(keysPath, { force: true })
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
  await writeSettings(orcaPage, { uiLanguage: 'en' })
  // Why a foreground process: a lead pane back at its shell is not a live lead.
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
  // Why wait: workerStart resolves the worktree from the runtime's scan, which can lag launch.
  await expect
    .poll(
      async () =>
        (
          await client.call<{ worktrees: { id: string }[] }>('worktree.list', {})
        ).result.worktrees.some((one) => one.id === worktreeId),
      { timeout: 60_000, message: "the runtime never listed the lead's worktree" }
    )
    .toBe(true)
  const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
    objective: 'Permission prompt',
    from: lead
  })
  const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
    spec: 'Work on ORCA-1216',
    taskTitle: 'ORCA-1216',
    run: run.result.run.id,
    callerTerminalHandle: lead
  })
  const launched = await client.call<{
    effects: { kind: string; role?: string; id?: string }[]
  }>('orchestration.workerStart', {
    task: task.result.task.id,
    from: lead,
    worktree: `id:${worktreeId}`,
    displayName: 'ORCA-1216',
    agent: 'codex',
    timeoutMs: 20_000
  })
  expect(launched.result.effects.some((effect) => effect.role === 'agent')).toBe(true)
  // Why by title: the fake Codex names its own pane, as the stdout-visibility spec finds its worker.
  let worker: RuntimeTerminalListResult['terminals'][number] | undefined
  await expect
    .poll(async () => {
      const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
      worker = listed.result.terminals.find((one) => one.title === 'Codex Ready')
      return worker?.handle ?? null
    })
    .toBeTruthy()
  const member = worker!.handle
  const shown = { result: { terminal: { tabId: worker!.tabId, leafId: worker!.leafId } } }
  const memberPaneKey = `${worker!.tabId}:${worker!.leafId}`

  // Why wait: Orca stops typing into a pane its hooks say waits on a prompt, so the brief goes first.
  await expect
    .poll(() => readKeys().includes('"\\r"'), {
      timeout: 60_000,
      message: 'the brief never landed'
    })
    .toBe(true)
  // The member's real Claude 2.1.325 hooks up to its open Bash permission prompt, and its screen.
  for (const payload of HOOKS) {
    const response = await fetch(`http://127.0.0.1:${endpoint.port}/hook/claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Orca-Agent-Hook-Token': endpoint.token },
      body: JSON.stringify({
        paneKey: memberPaneKey,
        tabId: shown.result.terminal.tabId,
        worktreeId,
        env: endpoint.env,
        version: endpoint.version,
        payload
      })
    })
    expect(response.status, `${payload.hook_event_name} was refused`).toBe(204)
  }
  const tail = async (): Promise<string> =>
    (
      await client.call<{ terminal: { tail: string[] } }>('terminal.read', {
        terminal: member,
        limit: 60
      })
    ).result.terminal.tail.join('\n')
  // Why first: a screen the read cannot see would leave the hook's word standing either way.
  await expect
    .poll(tail, { timeout: 30_000, message: 'the member pane never drew the dialog' })
    .toContain('Esc to cancel')
  await withStoppedMembers(electronApp)
  // Why the lead's turn ends: a lead still waiting on members must not read Done (ORCA-1205).
  await emitCodexHookStatus(endpoint, { paneKey: pane.paneKey, worktreeId, state: 'done' })

  await setLook(orcaPage, 'plain')
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('team')
  })
  const panel = orcaPage.getByTestId('team-panel')
  const card = panel.locator(`[data-team-card="member"][data-pane-key="${memberPaneKey}"]`)
  const rosalina = panel.locator('[data-team-card="member"][data-pane-key="seed:1198"]')
  const leadCard = panel.locator('[data-team-card="lead"]')
  await expect(card).toBeVisible({ timeout: 90_000 })

  await expect(card).toContainText('Permission prompt: Bash', { timeout: 30_000 })
  await expect(card).not.toContainText('Waiting for your answer')
  await expect(card.getByRole('button', { name: 'Answer in Inbox' })).toHaveCount(0)
  await expect(rosalina).toContainText('CI failing')
  await expect(rosalina).not.toContainText('Done')
  // Why 2: the member at its prompt and Rosalina on red CI; the merged one is finished.
  await expect(leadCard).toContainText('Waiting on 2 agents')
  await expect(leadCard).not.toContainText('Done')
  await capture(electronApp, orcaPage, panel, 'team-card-permission-prompt', testInfo)

  // The Inbox holds no question for it, and says so.
  const inboxTab = panel.getByRole('tab', { name: /Inbox/ })
  await inboxTab.click()
  await expect(panel.getByText('Nothing waits for you')).toBeVisible()
  await capture(electronApp, orcaPage, panel, 'inbox-with-permission-prompt', testInfo)
  await panel.getByRole('tab', { name: /^Team/ }).click()

  for (const style of ['office', 'pixel'] as const) {
    await setLook(orcaPage, 'game', style)
    const scene = panel.locator(`[data-team-scene="${style}"]`)
    await expect(scene.getByRole('img', { name: 'Live team scene' }).first()).toBeVisible({
      timeout: 30_000
    })
    await capture(electronApp, orcaPage, panel, `scene-${style}-prompt-and-red-ci`, testInfo)
  }
  await setLook(orcaPage, 'plain')

  const answer = card.getByRole('button', { name: 'Answer in its terminal' })
  await answer.click()
  await expect
    .poll(() => orcaPage.evaluate(() => window.__store!.getState().activeTabId))
    .toBe(shown.result.terminal.tabId)

  // The person cancels the prompt with Esc; Claude fires no hook, so only the screen says so.
  await client.call('terminal.send', { terminal: member, text: '\u001b' })
  await expect
    .poll(tail, { timeout: 15_000, message: `keys the member read: ${readKeys()}` })
    .toContain('What should Claude do instead?')
  await expect
    .poll(
      async () => {
        await refreshTeam(electronApp)
        return (await card.textContent()) ?? ''
      },
      { timeout: 30_000, message: 'the card still shows the cancelled prompt' }
    )
    .not.toContain('Permission prompt')
  await expect(card).toContainText('Idle')
  await expect(card.getByRole('button', { name: 'Answer in its terminal' })).toHaveCount(0)
  await capture(electronApp, orcaPage, panel, 'team-card-after-cancel', testInfo)
})
