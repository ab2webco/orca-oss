import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'
import template from '../../src/shared/orchestrator-game-scene-template.json'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

// Quest's sword tone (team-scene-pixel-prop.ts) and a hammer no other scene colour matches.
const SWORD = [0xe8, 0xee, 0xf4] as const
const HAMMER_HEAD = [0x9c, 0x9c, 0xa8] as const
// The scene guide's own plumber costume, so the themed file reads as the owner's Mario scene.
const PLUMBER = {
  rows: ['...CCCCC..', '..CCCCCCCC', '..HHSSES..', '..SSSHHHH.', '..RROYORR.', '.SROOOOORS'],
  legs: ['..HH..HH..', '.HH....HH.'],
  colors: {
    C: '#d82800',
    H: '#883c00',
    S: '#fca044',
    E: '#000000',
    R: '#d82800',
    O: '#2038ec',
    Y: '#fcd800'
  }
}
const themed = (prop?: unknown): string =>
  JSON.stringify({
    ...template,
    costumes: Object.fromEntries(Object.keys(template.costumes).map((one) => [one, PLUMBER])),
    ...(prop === undefined ? {} : { prop })
  })
const SCENES = [
  { name: null, prop: 'sword' },
  { name: 'mario-bros.json', prop: 'none' },
  { name: 'mario-hammer.json', prop: 'hammer' }
] as const

test.use({ orcaAppExtraEnv: { ORCA_E2E_SHOW_INACTIVE: '1' } })

// Pixels of one colour under the sky band, over a second, so a swing between strokes still counts.
async function colourPixels(page: Page, rgb: readonly number[]): Promise<number> {
  return page.evaluate(
    (rgb) =>
      new Promise<number>((resolve) => {
        let best = 0
        const count = (): void => {
          const canvas = document.querySelector<HTMLCanvasElement>('[data-team-scene] [role="img"]')
          const g = canvas?.getContext('2d')
          if (!canvas || !g || canvas.width === 0) {
            return
          }
          const top = Math.floor(canvas.height * 0.4)
          const { data } = g.getImageData(0, top, canvas.width, canvas.height - top)
          let n = 0
          for (let i = 0; i < data.length; i += 4) {
            const near = [0, 1, 2].every((c) => Math.abs(data[i + c]! - rgb[c]!) <= 2)
            n += near ? 1 : 0
          }
          best = Math.max(best, n)
        }
        let frames = 0
        const tick = (): void => {
          count()
          frames += 1
          if (frames < 20) {
            setTimeout(() => requestAnimationFrame(tick), 50)
          } else {
            resolve(best)
          }
        }
        requestAnimationFrame(tick)
      }),
    [...rgb]
  )
}

// ORCA-1202: a themed scene file drew every character in the Pixel band with Quest's sword.
test("Pixel draws Quest's sword for Quest only, and a scene file's own prop or none", async ({
  electronApp,
  orcaPage,
  testRepoPath
}, testInfo) => {
  test.setTimeout(900_000)
  const agent = createStdinLoggingAgent()
  const scenesDir = join(testRepoPath, '.orca', 'scenes')
  try {
    mkdirSync(scenesDir, { recursive: true })
    writeFileSync(join(scenesDir, 'mario-bros.json'), themed())
    writeFileSync(
      join(scenesDir, 'mario-hammer.json'),
      themed({
        rows: ['HHH', 'HHH', '.W.', '.W.'],
        colors: { H: '#9c9ca8', W: '#8a5a2c' }
      })
    )
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
    const repoId = await orcaPage.evaluate(() => window.__store!.getState().repos[0]!.id)
    await writeSettings(orcaPage, {
      uiLanguage: 'en',
      defaultTuiAgent: 'codex',
      agentCmdOverrides: { codex: agent.command },
      agentDefaultArgs: { codex: '' },
      orchestratorGame: { panel: { style: 'pixel' } }
    })
    await client.call('terminal.send', {
      terminal: lead,
      text: 'node -e "setInterval(() => {}, 1e9)"',
      enter: true
    })
    await expect
      .poll(
        async () =>
          (
            await client.call<{ registered: boolean }>('game.leadRegister', {
              terminalHandle: lead,
              project: 'e2e',
              label: 'Alfred'
            })
          ).result.registered
      )
      .toBe(true)
    const endpoint = await readHookEndpoint(electronApp)
    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Scene prop',
      from: lead
    })
    await expect
      .poll(
        async () =>
          (
            await client.call<{ worktrees: { id: string }[] }>('worktree.list', {})
          ).result.worktrees.some((one) => one.id === worktreeId),
        { timeout: 60_000 }
      )
      .toBe(true)
    const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: 'Work on ORCA-12',
      taskTitle: 'ORCA-12',
      run: run.result.run.id,
      callerTerminalHandle: lead
    })
    const started = await client.call<{ effects: { kind: string; role?: string; id?: string }[] }>(
      'orchestration.workerStart',
      {
        task: task.result.task.id,
        from: lead,
        worktree: `id:${worktreeId}`,
        displayName: 'ORCA-12',
        agent: 'codex',
        timeoutMs: 20_000
      }
    )
    const handle = started.result.effects.find(
      (e) => e.kind === 'terminal' && e.role === 'agent'
    )?.id
    const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
    const terminal = listed.result.terminals.find((one) => one.handle === handle)
    expect(terminal, 'workerStart opened no listed agent terminal').toBeTruthy()
    const member = { paneKey: `${terminal!.tabId}:${terminal!.leafId}`, worktreeId }
    const stateOf = async (): Promise<OrchestratorGameState> =>
      (
        await client.call<OrchestratorGameState>('game.state', {
          worktreeId,
          terminalHandle: lead,
          paneKey: pane.paneKey
        })
      ).result
    await expect
      .poll(
        async () => {
          await emitCodexHookStatus(endpoint, { ...member, state: 'working', prompt: 'Work' })
          return (await stateOf()).agents.find((one) => one.isMember)?.state
        },
        { timeout: 90_000, message: 'game.state never listed the working member' }
      )
      .toBe('working')

    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const scene = orcaPage.getByTestId('team-panel').locator('[data-team-scene="pixel"]')
    for (const { name, prop } of SCENES) {
      const sceneFile = name === null ? undefined : `.orca/scenes/${name}`
      await writeSettings(orcaPage, {
        theme: 'dark',
        orchestratorGameProjects: { [repoId]: sceneFile ? { sceneFile } : {} }
      })
      await expect
        .poll(
          async () => {
            const id = (await stateOf()).config?.scene ?? ''
            return name === null ? !id.endsWith('.json') : id.endsWith(name)
          },
          { timeout: 30_000, message: `game.state never published ${name ?? 'Quest'}` }
        )
        .toBe(true)
      await emitCodexHookStatus(endpoint, { ...member, state: 'working', prompt: 'Work' })
      await expect(scene.getByRole('img', { name: 'Live team scene' })).toBeVisible({
        timeout: 30_000
      })
      // Why polled on what is drawn: the panel picks the new scene up on its own 20 s refresh, and
      // Mario follows Quest, so its sword going away is what proves the switch.
      const drawn = async (): Promise<{ sword: number; hammer: number }> => ({
        sword: await colourPixels(orcaPage, SWORD),
        hammer: await colourPixels(orcaPage, HAMMER_HEAD)
      })
      const expected = {
        sword: { sword: true, hammer: false },
        none: { sword: false, hammer: false },
        hammer: { sword: false, hammer: true }
      }[prop]
      let last = { sword: 0, hammer: 0 }
      await expect
        .poll(
          async () => {
            last = await drawn()
            return { sword: last.sword > 0, hammer: last.hammer > 0 }
          },
          { timeout: 60_000, message: `${name ?? 'Quest'} never drew its own prop` }
        )
        .toEqual(expected)
      testInfo.annotations.push({
        type: 'prop',
        description: `${name ?? 'quest'}: sword ${last.sword} px, hammer head ${last.hammer} px`
      })
      const label = (name ?? 'quest.json').replace('.json', '')
      for (const render of ['classic', 'hd'] as const) {
        // Why both keys: the panel style must survive the render switch.
        await writeSettings(orcaPage, { orchestratorGame: { panel: { style: 'pixel' }, render } })
        for (const width of [1440, 390]) {
          await orcaPage.setViewportSize({ width, height: 900 })
          for (const theme of ['dark', 'light'] as const) {
            await writeSettings(orcaPage, { theme })
            await orcaPage.waitForTimeout(600)
            await scene.screenshot({
              path: testInfo.outputPath(`prop-${label}-${render}-${width}-${theme}.png`)
            })
          }
        }
        await orcaPage.setViewportSize({ width: 1440, height: 900 })
      }
    }
  } finally {
    agent.dispose()
    // Why: the seeded repo is shared by the worker's later specs.
    for (const name of ['mario-bros.json', 'mario-hammer.json']) {
      rmSync(join(scenesDir, name), { force: true })
    }
  }
})
