import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  launchMember,
  runCli,
  startLead,
  writeArgvLoggingAgent,
  writeRealCli
} from './helpers/game-cycle-contract'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { claudeVersionOk, screenRows, startGameBand } from './helpers/orchestrator-game-band'
import { startMessagesApi } from './helpers/showcase-messages-api'
import { waitForActivePaneHookDescriptor } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import { writeSettings } from './helpers/settings-write'

// ORCA-1005: orca-game is a Claude Code mod Orca passes with --plugin-dir, not an Orca plugin, so
// the plugin system being off must neither drop it nor break the text layer it draws.
const NOT_RUN = 'NOT RUN: needs Claude Code 2.1.287 or newer on PATH'
const BAND_MARKS = /[▤↻♥⚑▀▄▌▐]/

type LeadRead = {
  agents?: { isLeader?: boolean; displayName?: string | null }[]
  worktree?: { displayName?: string }
  lead?: { label?: string }
  leadName?: string
}

/** The lead's name as the mod draws it: the host's shown name, else its title, worktree or label. */
function leadNameOf(stdout: string, paneWorktreeName: string): string {
  const parsed = JSON.parse(stdout) as LeadRead & { result?: LeadRead }
  const state = parsed.result ?? parsed
  // Why first: the host sends the name its Team card shows beside the lead record (ORCA-1140).
  const shown = state.lead ? state.leadName?.trim() : ''
  if (shown) {
    return shown
  }
  const leader = state.agents?.find((one) => one.isLeader)
  const worktreeName = state.worktree?.displayName ?? paneWorktreeName
  const name = (leader?.displayName ?? worktreeName).split(' · ')[0]?.trim()
  return name || state.lead?.label || 'Lead'
}

async function expectPluginSystemOff(page: Page) {
  const plugins = await page.evaluate(async () => ({
    enabled: (await window.api.settings.get()).pluginSystemEnabled,
    count: (await window.api.plugins.list()).length
  }))
  expect(plugins).toEqual({ enabled: false, count: 0 })
}

test.describe('plugin system off, real Claude Code', () => {
  // Why at describe level: a case CI cannot run is reported not run before the app launches.
  test.skip(!claudeVersionOk(), NOT_RUN)

  test('Orca still launches a member with the orca-game mod', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    test.setTimeout(300_000)
    const agent = createStdinLoggingAgent()
    const dir = await mkdtemp(path.join(tmpdir(), 'orca-e2e-game-launch-'))
    try {
      const lead = await startLead(electronApp, orcaPage, agent)
      await expectPluginSystemOff(orcaPage)
      const claude = await writeArgvLoggingAgent(dir, agent)
      const current = await orcaPage.evaluate(() => {
        const settings = window.__store!.getState().settings
        return { commands: settings?.agentCmdOverrides, args: settings?.agentDefaultArgs }
      })
      await writeSettings(orcaPage, {
        agentCmdOverrides: { ...current.commands, claude: claude.command },
        agentDefaultArgs: { ...current.args, claude: '' }
      })
      await launchMember(lead, agent, 'E2E-51', 'claude')
      const launches = (await claude.launches()).trim().split('\n').filter(Boolean)
      await writeFile(testInfo.outputPath('launches.jsonl'), launches.join('\n'))
      expect(launches).toHaveLength(1)
      const { argv, env } = JSON.parse(launches[0]!) as {
        argv: string[]
        env: Record<string, string>
      }
      const at = argv.indexOf('--plugin-dir')
      expect(at, `no --plugin-dir in ${argv.join(' ')}`).toBeGreaterThanOrEqual(0)
      expect(path.normalize(argv[at + 1]!)).toBe(
        path.join(process.cwd(), 'resources', 'claude-plugins', 'orca-game')
      )
      expect(env).toMatchObject({ ORCA_GAME_ROLE: 'member', ORCA_GAME_MODE: expect.any(String) })
      expect(env.ORCA_GAME_MODE).not.toBe('off')
    } finally {
      agent.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('a lead pane draws the text layer from the real orca CLI', async ({
    electronApp,
    orcaPage,
    testRepoPath
  }, testInfo) => {
    test.setTimeout(300_000)
    const prompt = 'How is the build?'
    const answer = 'The build is green and PR 41 is in review.'
    const api = await startMessagesApi([{ match: /How is the build/, text: answer }])
    const dir = await mkdtemp(path.join(tmpdir(), 'orca-e2e-text-layer-'))
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const band = await startGameBand(orcaPage, testRepoPath, {
      state: null,
      theme: 'dark',
      locale: 'en',
      showcase: { apiUrl: api.url },
      cli: await writeRealCli(dir, userDataDir)
    })
    try {
      await expectPluginSystemOff(orcaPage)
      const pane = await waitForActivePaneHookDescriptor(orcaPage)
      const client = new RuntimeClient(userDataDir, 30_000, null, null)
      const handle = (
        await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
          paneKey: pane.paneKey
        })
      ).result.terminal.handle
      await expect
        .poll(async () => {
          const registered = await client.call<{ registered: boolean }>('game.leadRegister', {
            terminalHandle: handle,
            project: 'e2e',
            label: 'Alfred'
          })
          return registered.result.registered
        })
        .toBe(true)
      // The real CLI answers this pane as a lead, which is what the mod polls.
      const shown = await client.call<{ terminal: { worktreeId: string } }>('terminal.show', {
        terminal: handle
      })
      const read = runCli(
        userDataDir,
        { ORCA_TERMINAL_HANDLE: handle, ORCA_WORKTREE_ID: shown.result.terminal.worktreeId },
        ['game', 'state', '--json']
      )
      expect(read.status, read.stderr).toBe(0)
      await writeFile(testInfo.outputPath('game-state.json'), read.stdout)
      // Why the pane's worktree: this read has no worktree, while the mod's own read from the pane does.
      const paneWorktreeName = await orcaPage.evaluate(
        (id) =>
          Object.values(window.__store!.getState().worktreesByRepo)
            .flat()
            .find((one) => one.id === id)?.displayName ?? '',
        shown.result.terminal.worktreeId
      )

      await expect
        .poll(async () => (await screenRows(orcaPage)).join('\n'), { timeout: 60_000 })
        .toMatch(/❯|>/)
      await orcaPage.keyboard.type(prompt)
      await expect
        .poll(
          async () => {
            const isAnswered = (await screenRows(orcaPage))
              .join('\n')
              .includes('The build is green')
            if (!isAnswered) {
              await orcaPage.keyboard.press('Enter')
            }
            return isAnswered
          },
          { timeout: 60_000, intervals: [3_000] }
        )
        .toBe(true)
      const rows = await screenRows(orcaPage)
      await writeFile(testInfo.outputPath('screen.txt'), rows.join('\n'))
      await orcaPage.screenshot({
        path: testInfo.outputPath('text-layer.png'),
        animations: 'disabled'
      })
      const transcript = rows.slice(
        Math.max(
          0,
          rows.findIndex((row) => row.startsWith('❯ '))
        )
      )
      const screen = transcript.join('\n')
      // Why from the read: a lead speaks as its Team card names it (ORCA-1109); a failed read shows a scene card's name.
      expect(transcript, `no lead heading:\n${screen}`).toContainEqual(
        expect.stringMatching(new RegExp(`^${leadNameOf(read.stdout, paneWorktreeName)} · `))
      )
      expect(screen, `the band is drawn:\n${screen}`).not.toMatch(BAND_MARKS)
      expect(screen).not.toMatch(/orca: |Unknown command|ECONNREFUSED/)
    } finally {
      await api.close()
      await rm(band.root, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  })
})
