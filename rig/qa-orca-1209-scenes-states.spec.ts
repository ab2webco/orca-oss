import { writeFile } from 'node:fs/promises'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
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
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

// ORCA-1209 QA rig (evidence branch only): one real lead and one real member per agent state, in
// every scene at every window width and theme, with the Team list and sidebar read from the DOM.
test.use({ orcaAppExtraEnv: { ORCA_E2E_SHOW_INACTIVE: '1' } })

const WIDTHS = [1440, 768, 390, 320] as const
const THEMES = ['light', 'dark'] as const
const SCENES = [
  { name: 'office-3d', panel: { style: 'office', quality: 'high', diorama: true }, webgl: true },
  { name: 'office-2d', panel: { style: 'office', quality: 'low', diorama: true }, webgl: false },
  { name: 'figures-3d', panel: { style: 'figures', quality: 'high', diorama: true }, webgl: true },
  {
    name: 'figures-low-resources',
    panel: { style: 'figures', quality: 'low', diorama: true },
    webgl: true
  },
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

async function refreshPanel(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('runtime:gameAdvisorChanged'))
  )
}

type DomReport = {
  innerWidth: number
  rightSidebarWidth: number | null
  scene: Record<string, string> | null
  cards: { text: string; tones: string[]; attrs: Record<string, string> }[]
  rows: { text: string; tones: string[]; glyphs: string[]; attrs: Record<string, string> }[]
}

async function readDom(page: Page): Promise<DomReport> {
  return page.evaluate(() => {
    const attrsOf = (node: Element): Record<string, string> =>
      Object.fromEntries(
        [...node.attributes]
          .filter((a) => a.name.startsWith('data-'))
          .map((a) => [a.name, a.value.slice(0, 200)])
      )
    const tonesOf = (node: Element): string[] =>
      [...node.querySelectorAll<HTMLElement>('[data-status-tone]')].map(
        (one) => one.dataset.statusTone ?? ''
      )
    const sceneRoot = document.querySelector('[data-team-scene]')
    const sceneAttrs: Record<string, string> = {}
    if (sceneRoot) {
      Object.assign(sceneAttrs, attrsOf(sceneRoot))
      for (const node of sceneRoot.querySelectorAll('*')) {
        for (const [k, v] of Object.entries(attrsOf(node))) {
          sceneAttrs[k] ??= v
        }
      }
    }
    const panel = document.querySelector<HTMLElement>('[data-testid="team-panel"]')
    return {
      innerWidth: window.innerWidth,
      rightSidebarWidth: panel ? Math.round(panel.getBoundingClientRect().width) : null,
      scene: sceneRoot ? sceneAttrs : null,
      cards: [...document.querySelectorAll('[data-team-card]')].map((card) => ({
        text: (card as HTMLElement).innerText.replace(/\s+/g, ' ').slice(0, 240),
        tones: tonesOf(card),
        attrs: attrsOf(card)
      })),
      rows: [...document.querySelectorAll('[data-sidebar-team-row]')].map((row) => ({
        text: (row as HTMLElement).innerText.replace(/\s+/g, ' ').slice(0, 200),
        tones: tonesOf(row),
        glyphs: [...row.querySelectorAll<HTMLElement>('[data-status-glyph]')].map(
          (one) => one.dataset.statusGlyph ?? ''
        ),
        attrs: attrsOf(row)
      }))
    }
  })
}

test('ORCA-1209 QA: every scene, width and theme with a member in each agent state', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(1_500_000)
  const agent = createStdinLoggingAgent()
  const report: Record<string, DomReport> = {}
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
    const now = Date.now()
    await seedRendererGameState(electronApp, {
      fields: {
        [panes.limited!.paneKey]: { limit: { resetsAt: now + 2 * 3_600_000 } },
        [panes.finished!.paneKey]: {
          workItem: {
            provider: 'plane',
            identifier: 'ORCA-2005',
            title: 'ORCA-2005',
            url: 'https://plane.example/ORCA-2005',
            status: 'Done',
            statusGroup: 'done'
          }
        },
        [panes['red-ci']!.paneKey]: {
          review: {
            provider: 'github',
            number: 2007,
            title: 'Red CI',
            url: 'https://github.com/example/repo/pull/2007',
            state: 'open',
            ci: 'failure'
          }
        }
      }
    })
    await client.call('game.ownerAsk', {
      worktreeId: leadWorktreeId,
      terminalHandle: lead,
      ticket: 'ORCA-2003',
      question: 'Merge #2003 now?',
      options: ['Yes', 'No']
    })
    const postHooks = async (): Promise<void> => {
      await emitCodexHookStatus(endpoint, {
        ...panes.working!,
        state: 'working',
        tool: 'Bash',
        toolInput: { command: 'npm test' }
      })
      await emitCodexHookStatus(endpoint, { ...panes.waiting!, state: 'working', prompt: 'Ask' })
      // Why idle by Stop: a member that ended its turn with no finished work reads Idle (ORCA-1205).
      for (const key of ['idle', 'limited', 'finished', 'red-ci'] as const) {
        await emitCodexHookStatus(endpoint, {
          ...panes[key]!,
          state: 'done',
          lastAssistantMessage: 'Done'
        })
      }
      await postCodex(endpoint, panes.blocked!, {
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf build' }
      })
    }
    // Real game.state (without the renderer overlay) for the report.
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
          await postHooks()
          const states = await realState()
          return states.filter((one) => /=(working|done|waiting)$/.test(one)).length
        },
        { timeout: 120_000, message: 'game.state never listed the hook states' }
      )
      .toBeGreaterThanOrEqual(8)
    testInfo.annotations.push({ type: 'game.state', description: (await realState()).join(', ') })

    await setWindowWidth(electronApp, orcaPage, 1440)
    // Sidebar alone (Team panel closed): its rows say what each agent does.
    // Why recorded, not asserted: a missing row is a finding to capture, not a reason to stop.
    let rowCount = 0
    for (let i = 0; i < 60 && rowCount < MEMBERS.length + 1; i++) {
      rowCount = await orcaPage.locator('[data-sidebar-team-row]').count()
      if (rowCount < MEMBERS.length + 1) {
        await orcaPage.waitForTimeout(2000)
      }
    }
    testInfo.annotations.push({ type: 'sidebar-rows', description: String(rowCount) })
    expect.soft(rowCount, 'the sidebar never drew every team row').toBe(MEMBERS.length + 1)
    await refreshPanel(electronApp)
    await orcaPage.waitForTimeout(3000)
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      for (const theme of THEMES) {
        await setTheme(orcaPage, theme)
        await orcaPage.mouse.move(0, 0)
        await orcaPage.waitForTimeout(1200)
        const id = `sidebar-${width}-${theme}`
        await orcaPage.screenshot({ path: testInfo.outputPath(`${id}.png`) })
        report[id] = await readDom(orcaPage)
      }
    }

    for (const scene of SCENES) {
      await setWindowWidth(electronApp, orcaPage, 1440)
      await writeSettings(orcaPage, {
        orchestratorGame: { scene: 'quest', panel: { look: 'game', ...scene.panel } }
      })
      await orcaPage.evaluate(() => {
        const s = window.__store!.getState()
        s.setRightSidebarOpen(true)
        s.setRightSidebarTab('team')
      })
      const root = orcaPage.getByTestId('team-panel').locator(`[data-team-scene="${scene.panel.style}"]`)
      await expect(root).toBeVisible({ timeout: 60_000 })
      if (scene.webgl) {
        await expect(root, `${scene.name}: WebGL is not on`).toHaveAttribute(
          'data-team-scene-webgl',
          'on',
          { timeout: 30_000 }
        )
      } else {
        await expect(root).not.toHaveAttribute('data-team-scene-webgl', 'on')
      }
      await expect(
        orcaPage.locator('[data-team-card="member"]'),
        `${scene.name}: the Team list lost members`
      ).toHaveCount(MEMBERS.length, { timeout: 60_000 })
      // Why: members walk in and greet the lead on the first round before they sit.
      await orcaPage.waitForTimeout(8000)
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        for (const theme of THEMES) {
          await setTheme(orcaPage, theme)
          await orcaPage.mouse.move(0, 0)
          await orcaPage.waitForTimeout(2000)
          const id = `${scene.name}-${width}-${theme}`
          await orcaPage.screenshot({ path: testInfo.outputPath(`page-${id}.png`) })
          const sceneBox = orcaPage.getByTestId('team-panel').locator('[data-team-scene]').first()
          if (await sceneBox.isVisible()) {
            await sceneBox.screenshot({ path: testInfo.outputPath(`scene-${id}.png`) })
          }
          const panelBox = orcaPage.getByTestId('team-panel')
          if (await panelBox.isVisible()) {
            await panelBox.screenshot({ path: testInfo.outputPath(`panel-${id}.png`) })
          }
          report[id] = await readDom(orcaPage)
        }
      }
      // The 3D scenes framed whole, once per theme at 1440.
      if (scene.webgl) {
        await setWindowWidth(electronApp, orcaPage, 1440)
        const showAll = orcaPage.getByTestId('team-panel').getByRole('button', { name: 'Show all' })
        if (await showAll.isVisible()) {
          await showAll.click()
          for (const theme of THEMES) {
            await setTheme(orcaPage, theme)
            await orcaPage.waitForTimeout(2500)
            await orcaPage
              .getByTestId('team-panel')
              .locator('[data-team-scene]')
              .first()
              .screenshot({ path: testInfo.outputPath(`scene-${scene.name}-showall-${theme}.png`) })
          }
          await orcaPage.getByTestId('team-panel').getByRole('button', { name: 'Follow the lead' }).click()
        }
      }
    }
  } finally {
    await writeFile(testInfo.outputPath('dom-report.json'), JSON.stringify(report, null, 2))
    agent.dispose()
  }
})
