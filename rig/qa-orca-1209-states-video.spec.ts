import { writeFile } from 'node:fs/promises'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import type { AgentHookEndpoint } from '../../src/shared/agent-hook-endpoint-file'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { seedRendererGameState } from './helpers/game-state-renderer-seed'
import { setTheme, setWindowWidth } from './helpers/settings-window'
import { writeSettings } from './helpers/settings-write'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import { startClip } from './helpers/showcase-clip'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

// ORCA-1209 QA rig (evidence branch only): one real lead and one real member per agent state, in
// every scene at every window width and theme, with the Team list and sidebar read from the DOM.
test.use({ orcaAppExtraEnv: { ORCA_E2E_SHOW_INACTIVE: '1' } })

const WIDTHS = [1440, 390] as const
const THEMES = ['light', 'dark'] as const
const SCENES = [
  { name: 'office-3d', panel: { style: 'office', quality: 'high', diorama: true }, webgl: true },
  { name: 'figures-2d', panel: { style: 'figures', quality: 'high', diorama: false }, webgl: false }
] as const

type Member = { key: string; ticket: string; name: string }
const MEMBERS: Member[] = [
  { key: 'working', ticket: 'ORCA-2001', name: 'Ana · ORCA-2001 Working' },
  { key: 'idle', ticket: 'ORCA-2002', name: 'Ben · ORCA-2002 Idle' },
  { key: 'waiting', ticket: 'ORCA-2003', name: 'Cleo · ORCA-2003 Needs you' },
  { key: 'limited', ticket: 'ORCA-2004', name: 'Dan · ORCA-2004 Limited' },
  { key: 'finished', ticket: 'ORCA-2005', name: 'Eva · ORCA-2005 Finished' },
  { key: 'blocked', ticket: 'ORCA-2006', name: 'Finn · ORCA-2006 Blocked' },
  { key: 'red-ci', ticket: 'ORCA-2007', name: 'Gil · ORCA-2007 Red CI' }
]

async function postCodex(
  endpoint: AgentHookEndpoint,
  at: { paneKey: string; worktreeId: string },
  payload: Record<string, unknown>
): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/hook/codex`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Orca-Agent-Hook-Token': endpoint.token },
    body: JSON.stringify({
      paneKey: at.paneKey,
      tabId: at.paneKey.split(':')[0],
      worktreeId: at.worktreeId,
      env: endpoint.env,
      version: endpoint.version,
      payload
    })
  })
  expect(response.status).toBe(204)
}

// Why: the Team panel re-reads game.state every 20 s; this event makes it read now, as a hook would.
async function refreshPanel(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('runtime:gameAdvisorChanged'))
  )
}

test('ORCA-1209 QA video: members change state live in Office 3D and Figures 2D', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(1_500_000)
  const agent = createStdinLoggingAgent()
  try {
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
    await writeSettings(orcaPage, {
      uiLanguage: 'en',
      defaultTuiAgent: 'codex',
      agentCmdOverrides: { codex: agent.command },
      agentDefaultArgs: { codex: '' }
    })
    await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarOpen(false))
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
      worktreeId: leadWorktreeId,
      state: 'working',
      prompt: 'Lead the team'
    })
    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'ORCA-1209 QA',
      from: lead
    })
    const panes: Record<string, { paneKey: string; worktreeId: string }> = {}
    for (const member of MEMBERS) {
      const worktreeId = await orcaPage.evaluate(async (branch) => {
        const state = window.__store!.getState()
        const active = Object.values(state.worktreesByRepo)
          .flat()
          .find((worktree) => worktree.id === state.activeWorktreeId)!
        return (await state.createWorktree(active.repoId, branch)).worktree.id
      }, member.ticket.toLowerCase())
      await expect
        .poll(() =>
          client.call('worktree.show', { worktree: `id:${worktreeId}` }).then(
            () => true,
            () => false
          )
        )
        .toBe(true)
      const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
        spec: `Work on ${member.ticket}`,
        taskTitle: member.name,
        run: run.result.run.id,
        callerTerminalHandle: lead
      })
      const started = await client.call<{
        effects: { kind: string; role?: string; id?: string }[]
      }>('orchestration.workerStart', {
        task: task.result.task.id,
        from: lead,
        worktree: `id:${worktreeId}`,
        displayName: member.name,
        agent: 'codex',
        timeoutMs: 20_000,
        game: true
      })
      const handle = started.result.effects.find(
        (effect) => effect.kind === 'terminal' && effect.role === 'agent'
      )?.id
      const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
      const terminal = listed.result.terminals.find((one) => one.handle === handle)
      expect(terminal, `the ${member.ticket} terminal is not listed`).toBeTruthy()
      panes[member.key] = { paneKey: `${terminal!.tabId}:${terminal!.leafId}`, worktreeId }
    }
    const p = (key: string) => panes[key]!
    const doneItem = (statusGroup: string) => ({
      workItem: {
        provider: 'plane',
        identifier: 'ORCA-2005',
        title: 'ORCA-2005',
        url: 'https://plane.example/ORCA-2005',
        status: statusGroup === 'done' ? 'Done' : 'In Progress',
        statusGroup
      }
    })
    const review = (ci: string) => ({
      review: {
        provider: 'github',
        number: 2007,
        title: 'Red CI',
        url: 'https://github.com/example/repo/pull/2007',
        state: 'open',
        ci
      }
    })
    const now = Date.now()
    await seedRendererGameState(electronApp, {
      fields: { [p('limited').paneKey]: { limit: { resetsAt: now + 2 * 3_600_000 } } }
    })
    // The starting point of every clip: Ben idle, Dan limited, everyone else working.
    const reset = async (): Promise<void> => {
      await seedRendererGameState(electronApp, {
        fields: {
          [p('finished').paneKey]: doneItem('started'),
          [p('red-ci').paneKey]: review('pending')
        }
      })
      for (const key of ['working', 'waiting', 'finished', 'blocked', 'red-ci'] as const) {
        await emitCodexHookStatus(endpoint, {
          ...p(key),
          state: 'working',
          tool: 'Bash',
          toolInput: { command: 'npm test' }
        })
      }
      for (const key of ['idle', 'limited'] as const) {
        await emitCodexHookStatus(endpoint, { ...p(key), state: 'done', lastAssistantMessage: 'Done' })
      }
    }
    const realState = async () =>
      (
        await client.call<{ agents: { displayName: string | null; state: string }[] }>(
          'game.state',
          { worktreeId: leadWorktreeId, terminalHandle: lead, paneKey: pane.paneKey }
        )
      ).result.agents.map((one) => `${one.displayName ?? '?'}=${one.state}`)
    await expect
      .poll(
        async () => {
          await reset()
          return (await realState()).filter((one) => /=(working|done)$/.test(one)).length
        },
        { timeout: 120_000, message: 'game.state never listed the hook states' }
      )
      .toBeGreaterThanOrEqual(8)

    const at = async (start: number, second: number): Promise<void> => {
      const wait = start + second * 1000 - Date.now()
      if (wait > 0) {
        await orcaPage.waitForTimeout(wait)
      }
    }
    const boxes: Record<string, { x: number; y: number; width: number; height: number; dpr: number; innerWidth: number }> = {}
    const timeline: string[] = [
      '0s all start: Ana, Cleo, Eva, Finn, Gil working; Ben idle; Dan limited',
      '3s Cleo: working -> waiting (owner question on ORCA-2003)',
      '7s Finn: working -> permission prompt (Codex PermissionRequest, Bash)',
      '11s Gil: working -> stopped with red CI (CI failing gesture)',
      '15s Cleo: question answered -> working',
      '18s Eva: working -> done (ticket Done)',
      '21s Ana: working -> idle (Stop)',
      '25s end'
    ]
    testInfo.annotations.push({ type: 'timeline', description: timeline.join(' | ') })
    for (const scene of SCENES) {
      await writeSettings(orcaPage, {
        orchestratorGame: { scene: 'quest', panel: { look: 'game', ...scene.panel } }
      })
      await orcaPage.evaluate(() => {
        const s = window.__store!.getState()
        s.setRightSidebarOpen(true)
        s.setRightSidebarTab('team')
      })
      const panel = orcaPage.getByTestId('team-panel')
      const root = panel.locator(`[data-team-scene="${scene.panel.style}"]`)
      await expect(root).toBeVisible({ timeout: 60_000 })
      if (scene.webgl) {
        await expect(root).toHaveAttribute('data-team-scene-webgl', 'on', { timeout: 30_000 })
      }
      await expect(orcaPage.locator('[data-team-card="member"]')).toHaveCount(MEMBERS.length, {
        timeout: 60_000
      })
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        for (const theme of THEMES) {
          await setTheme(orcaPage, theme)
          await reset()
          await refreshPanel(electronApp)
          await orcaPage.mouse.move(0, 0)
          // Why: members walk in and sit after a scene or size change; the clip starts settled.
          await orcaPage.waitForTimeout(8000)
          const id = `${scene.name}-${width}-${theme}`
          const box = (await panel.boundingBox())!
          boxes[id] = {
            ...box,
            ...(await orcaPage.evaluate(() => ({
              dpr: window.devicePixelRatio,
              innerWidth: window.innerWidth
            })))
          }
          const clip = await startClip(electronApp, testInfo.outputPath(`raw-${id}.mp4`))
          const start = Date.now()
          await at(start, 3)
          const asked = await client.call<{ question: { id: string } }>('game.ownerAsk', {
            worktreeId: leadWorktreeId,
            terminalHandle: lead,
            ticket: 'ORCA-2003',
            question: 'Merge #2003 now?',
            options: ['Yes', 'No']
          })
          await refreshPanel(electronApp)
          await at(start, 7)
          await postCodex(endpoint, p('blocked'), {
            hook_event_name: 'PermissionRequest',
            tool_name: 'Bash',
            tool_input: { command: 'rm -rf build' }
          })
          await refreshPanel(electronApp)
          await at(start, 11)
          await seedRendererGameState(electronApp, {
            fields: { [p('red-ci').paneKey]: review('failure') }
          })
          await emitCodexHookStatus(endpoint, { ...p('red-ci'), state: 'done', lastAssistantMessage: 'Done' })
          await refreshPanel(electronApp)
          await at(start, 15)
          await client.call('game.ownerAnswer', {
            worktreeId: leadWorktreeId,
            terminalHandle: lead,
            id: asked.result.question.id,
            option: 1
          })
          await emitCodexHookStatus(endpoint, { ...p('waiting'), state: 'working', prompt: 'Merge' })
          await refreshPanel(electronApp)
          await at(start, 18)
          await seedRendererGameState(electronApp, {
            fields: { [p('finished').paneKey]: doneItem('done') }
          })
          await emitCodexHookStatus(endpoint, { ...p('finished'), state: 'done', lastAssistantMessage: 'Done' })
          await refreshPanel(electronApp)
          await at(start, 21)
          await emitCodexHookStatus(endpoint, { ...p('working'), state: 'done', lastAssistantMessage: 'Done' })
          await refreshPanel(electronApp)
          await at(start, 25)
          const stats = await clip.stop()
          testInfo.annotations.push({ type: `clip ${id}`, description: JSON.stringify(stats) })
        }
      }
    }
    await writeFile(testInfo.outputPath('boxes.json'), JSON.stringify(boxes, null, 2))
  } finally {
    agent.dispose()
  }
})
