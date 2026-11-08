import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { runOrcaCli } from './helpers/orca-cli-process'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { cleanupE2EDaemons } from './helpers/electron-process-shutdown'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { GameInboxThreads } from '../../src/shared/orchestrator-game-inbox-threads'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

const ADOPTED = 'Adoptee'

type Agents = { result?: { agents?: GameAgentRow[]; pausedMembers?: { name: string | null }[] } }
type GameAgentRow = {
  found?: boolean
  isMember?: boolean
  terminalHandle?: string
  displayName?: string
  paneKey: string
}

// ORCA-1141 R10: after a cold restart the adopted member's pane and tab were gone, while a
// launched member came back.
test('an adopted member keeps its tab, membership, name and thread across a cold restart', async ({
  flushRendererRecoveryEvidenceQueue
}, testInfo) => {
  void flushRendererRecoveryEvidenceQueue
  test.setTimeout(420_000)
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
    : ''
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')
  const agent = createStdinLoggingAgent()
  const session = createRestartSession(testInfo)
  let app: ElectronApplication | null = null
  try {
    let launch = await session.launch()
    app = launch.app
    let page = launch.page
    const worktreeId = await attachRepoAndOpenTerminal(page, repoPath)
    await waitForSessionReady(page)
    await page.evaluate(async (command) => {
      await window.__store?.getState().updateSettings({
        defaultTuiAgent: 'codex',
        agentCmdOverrides: { codex: command },
        agentDefaultArgs: { codex: '' }
      })
    }, agent.command)
    await ensureTerminalVisible(page)
    await waitForActivePanePtyId(page)
    const pane = await waitForActivePaneHookDescriptor(page)
    const client = new RuntimeClient(session.userDataDir, 30_000, null, null)
    const lead = (
      await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
        paneKey: pane.paneKey
      })
    ).result.terminal.handle
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
    let worktrees: { id: string; repoId: string }[] = []
    await expect
      .poll(
        async () => {
          worktrees = (
            await client.call<{ worktrees: { id: string; repoId: string }[] }>('worktree.list', {})
          ).result.worktrees
          const repoId = worktrees.find((one) => one.id === worktreeId)?.repoId
          return worktrees.filter((one) => one.repoId === repoId).length
        },
        { timeout: 60_000, message: "the runtime never listed the project's two worktrees" }
      )
      .toBeGreaterThanOrEqual(2)
    const leadRepo = worktrees.find((one) => one.id === worktreeId)?.repoId
    const otherWorktreeId = worktrees.find(
      (one) => one.repoId === leadRepo && one.id !== worktreeId
    )!.id

    // The agent to adopt: started by hand in the project's other worktree, idle at its prompt.
    const found = await client.call<{ terminal: { handle: string; paneKey: string } }>(
      'terminal.create',
      { worktree: `id:${otherWorktreeId}`, title: ADOPTED, command: agent.command }
    )
    const foundTab = found.result.terminal.paneKey.split(':')[0]
    const endpoint = await readHookEndpoint(app)
    for (const state of ['working', 'done'] as const) {
      await emitCodexHookStatus(endpoint, {
        paneKey: found.result.terminal.paneKey,
        worktreeId: otherWorktreeId,
        state,
        ...(state === 'working'
          ? { prompt: 'Polish the scene' }
          : { lastAssistantMessage: 'Done.' })
      })
    }
    const cli = (args: string[], handle = lead) =>
      runOrcaCli(
        session.userDataDir,
        { ORCA_TERMINAL_HANDLE: handle, ORCA_WORKTREE_ID: worktreeId, ORCA_PANE_KEY: pane.paneKey },
        args
      )
    const agents = (): GameAgentRow[] => {
      const state = cli(['game', 'state', '--json'])
      writeFileSync(testInfo.outputPath('game-state.json'), state.stdout || state.stderr)
      return (JSON.parse(state.stdout || '{}') as Agents).result?.agents ?? []
    }
    let name: string | null = null
    await expect
      .poll(
        () => {
          name =
            agents().find((one) => one.found && one.terminalHandle === found.result.terminal.handle)
              ?.displayName ?? null
          return name
        },
        { timeout: 60_000, message: 'the hand-started agent never showed as found' }
      )
      .not.toBeNull()
    await client.call('orchestration.runCreate', {
      objective: 'Adopted member restart',
      from: lead
    })
    const adopt = cli(['game', 'adopt', name!, '--force', '--json'])
    expect(adopt.status, `${adopt.stdout}\n${adopt.stderr}`).toBe(0)
    const firstDispatch = (JSON.parse(adopt.stdout) as { result: { dispatchId: string } }).result
      .dispatchId
    await expect
      .poll(
        () => agents().some((one) => one.isMember && one.paneKey === found.result.terminal.paneKey),
        {
          timeout: 60_000,
          message: 'the adopted agent never read as a member'
        }
      )
      .toBe(true)

    // Each dispatch's capability rides in the brief typed into the agent; it reports with it.
    const report = async (
      handle: string,
      to: string,
      dispatchId: string,
      subject: string
    ): Promise<void> => {
      let capability: string | null = null
      await expect
        .poll(
          () => {
            const brief = agent
              .readStdin()
              .split(/(?=Your task ID is:)/)
              .find((part) => part.includes(dispatchId))
            capability =
              /--dispatch-capability (dcap_[A-Za-z0-9_-]+)/.exec(brief ?? '')?.[1] ?? null
            return capability
          },
          { timeout: 60_000, message: `no capability reached the agent for ${dispatchId}` }
        )
        .not.toBeNull()
      await client.call(
        'orchestration.send',
        {
          from: handle,
          to,
          type: 'status',
          subject,
          body: subject,
          payload: JSON.stringify({ dispatchId })
        },
        { orchestrationCapability: capability! }
      )
    }
    await report(found.result.terminal.handle, lead, firstDispatch, 'before the restart')

    // A cold restart: quit, then kill the daemon that holds the agents' processes.
    await session.close(app)
    app = null
    await cleanupE2EDaemons(session.userDataDir)
    launch = await session.launch()
    app = launch.app
    page = launch.page
    await waitForSessionReady(page)

    await expect
      .poll(
        () =>
          page.evaluate(
            ([id, tab]) =>
              (window.__store!.getState().tabsByWorktree[id] ?? []).some((one) => one.id === tab),
            [otherWorktreeId, foundTab] as const
          ),
        { timeout: 60_000, message: "the adopted member's tab never came back" }
      )
      .toBe(true)
    // It runs a shell again, ready for its agent to resume in the user's own tab.
    await page.evaluate(
      ([id, tab]) => {
        window.__store!.getState().setActiveWorktree(id)
        window.__store!.getState().setActiveTab(tab)
      },
      [otherWorktreeId, foundTab] as const
    )
    await ensureTerminalVisible(page)
    await expect
      .poll(
        () =>
          page.evaluate(
            (tab) => window.__store!.getState().ptyIdsByTabId[tab]?.[0] ?? '',
            foundTab
          ),
        { timeout: 60_000, message: "the adopted member's tab never got a PTY" }
      )
      .not.toBe('')

    // ORCA-1141 criterion 2: its agent resumes in that tab, and the lead's resume-members (run at
    // once by its rules, as for a launched member) makes it a member again, with no new adopt.
    // Why shown, then writable: a restored tab lists its terminal before its PTY binds, and CI is slower.
    const resolve = async (
      paneKey: string,
      worktree: string
    ): Promise<{ handle: string; paneKey: string }> => {
      const [tabId] = paneKey.split(':')
      await page.evaluate(
        ([id, tab]) => {
          window.__store!.getState().setActiveWorktree(id)
          window.__store!.getState().setActiveTab(tab)
        },
        [worktree, tabId] as const
      )
      await ensureTerminalVisible(page)
      let hit: { handle: string; paneKey: string } | null = null
      await expect
        .poll(
          async () => {
            const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
            const one = listed.result.terminals.find(
              (t) => t.tabId === tabId && t.connected && t.writable
            )
            hit = one ? { handle: one.handle, paneKey: `${one.tabId}:${one.leafId}` } : null
            return hit
          },
          { timeout: 60_000, message: `no writable terminal came back in tab ${tabId}` }
        )
        .not.toBeNull()
      return hit!
    }
    const restoredPane = await resolve(found.result.terminal.paneKey, otherWorktreeId)
    const restored = restoredPane.handle
    writeFileSync(
      testInfo.outputPath('panes.json'),
      JSON.stringify({ before: found.result.terminal.paneKey, after: restoredPane.paneKey })
    )
    await client.call('terminal.send', { terminal: restored, text: agent.command, enter: true })
    const relaunched = await readHookEndpoint(app)
    for (const state of ['working', 'done'] as const) {
      await emitCodexHookStatus(relaunched, {
        paneKey: found.result.terminal.paneKey,
        worktreeId: otherWorktreeId,
        state,
        ...(state === 'working' ? { prompt: 'Back' } : { lastAssistantMessage: 'Back.' })
      })
    }
    const leadAfter = (await resolve(pane.paneKey, worktreeId)).handle
    await client.call('terminal.send', {
      terminal: leadAfter,
      text: 'node -e "setInterval(() => {}, 1e9)"',
      enter: true
    })
    await expect
      .poll(async () => {
        const registered = await client.call<{ registered: boolean }>('game.leadRegister', {
          terminalHandle: leadAfter,
          project: 'e2e',
          label: 'Alfred'
        })
        return registered.result.registered
      })
      .toBe(true)
    const cliAfter = (args: string[]) =>
      runOrcaCli(
        session.userDataDir,
        {
          ORCA_TERMINAL_HANDLE: leadAfter,
          ORCA_WORKTREE_ID: worktreeId,
          ORCA_PANE_KEY: pane.paneKey
        },
        args
      )
    const stateAfter = (): NonNullable<Agents['result']> => {
      const state = cliAfter(['game', 'state', '--json'])
      writeFileSync(testInfo.outputPath('game-state-after.json'), state.stdout || state.stderr)
      return (JSON.parse(state.stdout || '{}') as Agents).result ?? {}
    }
    await expect
      .poll(() => (stateAfter().pausedMembers ?? []).map((one) => one.name), {
        timeout: 60_000,
        message: 'the adopted member never read as paused after the restart'
      })
      .toEqual([name])
    let resumed = { stdout: '', stderr: '' }
    // Why polled: its pane reports an agent a moment after the command runs in it.
    await expect
      .poll(
        () => {
          resumed = cliAfter(['game', 'resume-members', '--json'])
          writeFileSync(testInfo.outputPath('resume.txt'), `${resumed.stdout}\n${resumed.stderr}`)
          return resumed.stdout.includes('"dispatchId"')
        },
        { timeout: 60_000, message: 'resume-members never resumed the adopted member' }
      )
      .toBe(true)
    const secondDispatch = (
      JSON.parse(resumed.stdout) as { result: { members: { dispatchId?: string }[] } }
    ).result.members.find((one) => one.dispatchId)!.dispatchId!
    await expect
      .poll(
        () =>
          (stateAfter().agents ?? []).some(
            (one) =>
              one.isMember &&
              !one.found &&
              one.paneKey === found.result.terminal.paneKey &&
              one.displayName === name
          ),
        { timeout: 60_000, message: 'the adopted agent is not a member under its name again' }
      )
      .toBe(true)

    // Same Inbox thread: both reports sit under its one name.
    await report(restored, leadAfter, secondDispatch, 'after the restart')
    await expect
      .poll(
        async () =>
          (
            await client.call<GameInboxThreads>('game.inboxThreads', { worktreeId })
          ).result.threads.map((one) => [one.ticket, one.messages.map((m) => m.subject).sort()]),
        { timeout: 30_000 }
      )
      .toEqual([[name, ['after the restart', 'before the restart']]])

    // Adopting it again finds the member it already is, and mints no new name.
    const again = cliAfter(['game', 'adopt', name!, '--json'])
    expect(JSON.parse(again.stdout).result).toMatchObject({ name, reused: true })
    await page.screenshot({ path: testInfo.outputPath('after-cold-restart.png') })
  } finally {
    if (app) {
      await session.close(app)
    }
    await session.dispose()
    agent.dispose()
  }
})
