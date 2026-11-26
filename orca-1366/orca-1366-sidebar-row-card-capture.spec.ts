/**
 * ORCA-1366 capture run (not committed): each sidebar team row says what its Team card says for
 * a lead asking the person, a member at a Bash permission prompt and a stopped member on red CI.
 */
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { setTheme, THEMES } from './helpers/settings-window'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'
import { worktreeRow } from './worktree-row-locators'

const SIDEBAR_WIDTHS = [220, 280, 500] as const
const FIXTURES = path.join(__dirname, '../../src/shared/__fixtures__/claude-permission-prompt')
const screenOf = (name: string): string =>
  readFileSync(path.join(FIXTURES, `${name}.txt`), 'utf8')
    .split('\n')
    .map((line) => line.slice(0, 60))
    .join('\n')
const HOOKS = JSON.parse(readFileSync(path.join(FIXTURES, 'hooks-until-prompt.json'), 'utf8')) as {
  hook_event_name: string
}[]

const fakeDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-1366-'))
// Why per worktree: each member's own log, so Gil's brief never stands in for Finn's.
const keysOf = (worktreeName: string) => path.join(fakeDir, `keys-${worktreeName}.log`)
// Why only in orca-2101: Finn draws Claude's Bash dialog once its brief lands; Gil stays quiet.
const fakeAgentSource = `
const { appendFileSync } = require('node:fs')
const finn = require('node:path').basename(process.cwd()) === 'orca-2101'
const keysPath = require('node:path').join(${JSON.stringify(fakeDir)}, 'keys-' + require('node:path').basename(process.cwd()) + '.log')
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
}
process.stdout.write('\\u001b]0;Codex Ready\\u0007OpenAI Codex\\nmodel: e2e\\ndirectory: e2e\\n')
let shown = false
process.stdin.on('data', (chunk) => {
  const input = chunk.toString()
  appendFileSync(keysPath, JSON.stringify(input) + '\\n')
  if (!shown && finn && (input.includes('\\r') || input.includes('\\n'))) {
    shown = true
    process.stdout.write('\\n' + ${JSON.stringify(screenOf('dialog-pending'))} + '\\n')
  }
})
process.stdin.resume()
setInterval(() => {}, 60_000)
`
writeFileSync(path.join(fakeDir, 'agent'), `#!/usr/bin/env node\n${fakeAgentSource}`)
chmodSync(path.join(fakeDir, 'agent'), 0o755)

test.afterAll(() => {
  rmSync(fakeDir, { recursive: true, force: true })
})

type Call = (
  event: unknown,
  args: { method: string }
) => Promise<{ result?: Record<string, unknown> }>

// Why: E2E has no PR provider, so Gil's red-CI PR is added to the real game.state on its way in.
async function addRedCiPr(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Call> })._invokeHandlers
    const real = handlers.get('runtime:call')!
    ipcMain.removeHandler('runtime:call')
    ipcMain.handle('runtime:call', async (event, args: { method: string }) => {
      const response = await real(event, args)
      if (args.method !== 'game.state' || !Array.isArray(response.result?.agents)) {
        return response
      }
      const agents = (response.result.agents as { displayName?: string }[]).map((one) =>
        one.displayName?.includes('ORCA-2102')
          ? {
              ...one,
              review: {
                provider: 'github',
                number: 2140,
                title: 'Retry the upload',
                url: 'https://github.com/o/r/pull/2140',
                state: 'open',
                ci: 'failure'
              }
            }
          : one
      )
      return { ...response, result: { ...response.result, agents } }
    })
  })
}

async function createBareWorktree(page: Page, client: RuntimeClient, name: string) {
  const id = await page.evaluate(async (branch) => {
    const state = window.__store!.getState()
    const active = Object.values(state.worktreesByRepo)
      .flat()
      .find((worktree) => worktree.id === state.activeWorktreeId)!
    return (await state.createWorktree(active.repoId, branch)).worktree.id
  }, name)
  await expect
    .poll(() =>
      client.call('worktree.show', { worktree: `id:${id}` }).then(
        () => true,
        () => false
      )
    )
    .toBe(true)
  return id
}

/** Every finite animation done, then two frames, so a shot never catches a slide mid-way. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((one) => one.effect?.getComputedTiming().endTime !== Infinity)
    await Promise.all(finite.map((one) => one.finished.catch(() => undefined)))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

async function shot(page: Page, target: Locator, name: string, testInfo: TestInfo) {
  await page.mouse.move(1, 899)
  await settle(page)
  await target.screenshot({ animations: 'disabled', path: testInfo.outputPath(`${name}.png`) })
}

const setTeamTab = (page: Page, open: boolean) =>
  page.evaluate((next) => {
    const state = window.__store!.getState()
    state.setRightSidebarOpen(next)
    if (next) {
      state.setRightSidebarTab('team')
    }
  }, open)

test('ORCA-1366: sidebar team rows say what their Team cards say', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(600_000)
  await waitForSessionReady(orcaPage)
  const leadWorktreeId = await waitForActiveWorktree(orcaPage)
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
  const repoId = await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    return state.getKnownWorktreeById(state.activeWorktreeId!)!.repoId
  })
  await writeSettings(orcaPage, {
    uiLanguage: 'en',
    defaultTuiAgent: 'codex',
    agentCmdOverrides: { codex: path.join(fakeDir, 'agent') },
    agentDefaultArgs: { codex: '' },
    orchestratorGameProjects: { [repoId]: { orchestrator: { label: 'Castle' } } }
  })
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
        label: 'Castle'
      })
      return registered.result.registered
    })
    .toBe(true)
  const endpoint = await readHookEndpoint(electronApp)
  await emitCodexHookStatus(endpoint, {
    paneKey: pane.paneKey,
    worktreeId: leadWorktreeId,
    state: 'working',
    prompt: 'Lead the team'
  })

  const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
    objective: 'ORCA-1366 capture',
    from: lead
  })
  const member = async (ticket: string, displayName: string) => {
    const worktreeId = await createBareWorktree(orcaPage, client, ticket.toLowerCase())
    const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: `Work on ${ticket}`,
      taskTitle: displayName,
      run: run.result.run.id,
      callerTerminalHandle: lead
    })
    const started = await client.call<{
      effects: { kind: string; role?: string; id?: string }[]
    }>('orchestration.workerStart', {
      task: task.result.task.id,
      from: lead,
      worktree: `id:${worktreeId}`,
      displayName,
      agent: 'codex',
      timeoutMs: 20_000,
      game: true
    })
    const handle = started.result.effects.find(
      (effect) => effect.kind === 'terminal' && effect.role === 'agent'
    )?.id
    const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
    const terminal = listed.result.terminals.find((one) => one.handle === handle)
    expect(terminal, `the ${ticket} terminal is not listed`).toBeTruthy()
    return {
      handle: handle!,
      tabId: terminal!.tabId,
      paneKey: `${terminal!.tabId}:${terminal!.leafId}`,
      worktreeId
    }
  }
  const finn = await member('ORCA-2101', 'Finn · ORCA-2101 Clean the cache')
  const gil = await member('ORCA-2102', 'Gil · ORCA-2102 Retry the upload')
  await addRedCiPr(electronApp)
  await client.call('game.ownerAsk', {
    worktreeId: leadWorktreeId,
    terminalHandle: lead,
    ticket: 'ORCA-2003',
    question: 'Merge #14 now?',
    options: ['Yes', 'No']
  })

  // Finn: Claude's real hooks up to its open Bash permission prompt, after its brief landed.
  const finnKeys = keysOf('orca-2101')
  try {
    await expect
      .poll(() => (existsSync(finnKeys) ? readFileSync(finnKeys, 'utf8') : '').includes('"\\r"'), {
        timeout: 60_000
      })
      .toBe(true)
  } catch {
    const logs = readdirSync(fakeDir).map(
      (name) => `${name}: ${readFileSync(path.join(fakeDir, name), 'utf8').slice(-300)}`
    )
    throw new Error(`Finn's brief never landed; logs:\n${logs.join('\n')}`)
  }
  for (const payload of HOOKS) {
    const response = await fetch(`http://127.0.0.1:${endpoint.port}/hook/claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Orca-Agent-Hook-Token': endpoint.token },
      body: JSON.stringify({
        paneKey: finn.paneKey,
        tabId: finn.tabId,
        worktreeId: finn.worktreeId,
        env: endpoint.env,
        version: endpoint.version,
        payload
      })
    })
    expect(response.status, `${payload.hook_event_name} was refused`).toBe(204)
  }
  await expect
    .poll(
      async () =>
        (
          await client.call<{ terminal: { tail: string[] } }>('terminal.read', {
            terminal: finn.handle,
            limit: 60
          })
        ).result.terminal.tail.join('\n'),
      { timeout: 30_000, message: 'Finn never drew the dialog' }
    )
    .toContain('Esc to cancel')
  // Gil: its turn ended with its PR open on red CI.
  await emitCodexHookStatus(endpoint, {
    paneKey: gil.paneKey,
    worktreeId: gil.worktreeId,
    state: 'working',
    prompt: 'Work'
  })
  await emitCodexHookStatus(endpoint, {
    paneKey: gil.paneKey,
    worktreeId: gil.worktreeId,
    state: 'done'
  })

  const expected = {
    lead: 'Waiting for you · Question on ORCA-2003',
    finn: 'Permission prompt: Bash',
    gil: 'CI failing'
  }
  await setTeamTab(orcaPage, false)
  const viewport = orcaPage.locator('[data-worktree-sidebar-root]')
  const act = (worktreeId: string, role: 'lead' | 'member') =>
    worktreeRow(orcaPage, worktreeId)
      .locator(`[data-sidebar-team-row="${role}"]`)
      .locator('[data-team-row-part="act"]')
  const rows = {
    lead: act(leadWorktreeId, 'lead'),
    finn: act(finn.worktreeId, 'member'),
    gil: act(gil.worktreeId, 'member')
  }
  for (const [who, text] of Object.entries(expected) as [keyof typeof expected, string][]) {
    await expect(rows[who], `${who}'s sidebar row`).toHaveText(text, { timeout: 120_000 })
    await expect(rows[who], `${who}'s sidebar row tone`).toHaveAttribute('data-asks', '')
  }

  for (const theme of THEMES) {
    await setTheme(orcaPage, theme)
    for (const width of SIDEBAR_WIDTHS) {
      await orcaPage.evaluate((w) => window.__store!.getState().setSidebarWidth(w), width)
      await expect
        .poll(async () => Math.round((await viewport.boundingBox())?.width ?? 0))
        .toBeGreaterThanOrEqual(width - 8)
      for (const [who, text] of Object.entries(expected) as [keyof typeof expected, string][]) {
        await expect(rows[who], `${who}'s row at ${width} ${theme}`).toHaveText(text)
      }
      await shot(orcaPage, viewport, `sidebar-${width}-${theme}`, testInfo)
    }
  }

  await orcaPage.evaluate(() => window.__store!.getState().setSidebarWidth(280))
  await setTeamTab(orcaPage, true)
  const panel = orcaPage.getByTestId('team-panel')
  const leadCard = panel.locator('[data-team-card="lead"]')
  const finnCard = panel.locator(`[data-team-card="member"][data-pane-key="${finn.paneKey}"]`)
  const gilCard = panel.locator(`[data-team-card="member"][data-pane-key="${gil.paneKey}"]`)
  await expect(leadCard).toContainText(expected.lead, { timeout: 60_000 })
  await expect(finnCard).toContainText(expected.finn)
  await expect(gilCard).toContainText(expected.gil)
  for (const theme of THEMES) {
    await setTheme(orcaPage, theme)
    await shot(orcaPage, panel, `team-panel-${theme}`, testInfo)
  }
})
