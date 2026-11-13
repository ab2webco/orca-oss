import { writeFileSync } from 'node:fs'
import { test, expect } from './helpers/orca-app'
import { createStdinLoggingAgent, type StdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { openTeamInbox, postLeadAgentRow } from './helpers/team-panel-inbox'
import { runOrcaCli } from './helpers/orca-cli-process'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { GameInboxThreads } from '../../src/shared/orchestrator-game-inbox-threads'
import { writeSettings } from './helpers/settings-write'

type Agents = {
  result?: { agents?: { found?: boolean; terminalHandle?: string; displayName?: string }[] }
}

// ORCA-1141: two agents adopted from one worktree took its name, and their mail shared one thread.
test('two adopted agents that share a worktree name get their own names and threads', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(360_000)
  const agents: StdinLoggingAgent[] = [createStdinLoggingAgent(), createStdinLoggingAgent()]
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
      defaultTuiAgent: 'codex',
      agentCmdOverrides: { codex: agents[0].command },
      agentDefaultArgs: { codex: '' }
    })
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
    await client.call('orchestration.runCreate', { objective: 'Same-name adoptees', from: lead })
    const endpoint = await readHookEndpoint(electronApp)
    const cli = (args: string[]) =>
      runOrcaCli(
        userDataDir,
        { ORCA_TERMINAL_HANDLE: lead, ORCA_WORKTREE_ID: worktreeId, ORCA_PANE_KEY: pane.paneKey },
        args
      )

    // Each agent is started by hand in the same worktree, then adopted by that shared name.
    const adopted: { handle: string; dispatchId: string; agent: StdinLoggingAgent }[] = []
    for (const agent of agents) {
      const found = await client.call<{ terminal: { handle: string; paneKey: string } }>(
        'terminal.create',
        { worktree: `id:${otherWorktreeId}`, command: agent.command }
      )
      for (const state of ['working', 'done'] as const) {
        await emitCodexHookStatus(endpoint, {
          paneKey: found.result.terminal.paneKey,
          worktreeId: otherWorktreeId,
          state,
          ...(state === 'working' ? { prompt: 'Polish' } : { lastAssistantMessage: 'Done.' })
        })
      }
      let name: string | null = null
      await expect
        .poll(
          () => {
            const state = cli(['game', 'state', '--json'])
            name =
              (JSON.parse(state.stdout || '{}') as Agents).result?.agents?.find(
                (one) => one.found && one.terminalHandle === found.result.terminal.handle
              )?.displayName ?? null
            return name
          },
          { timeout: 60_000, message: 'the hand-started agent never showed as found' }
        )
        .not.toBeNull()
      const adopt = cli(['game', 'adopt', name!, '--force', '--json'])
      writeFileSync(testInfo.outputPath(`adopt-${adopted.length}.txt`), adopt.stdout + adopt.stderr)
      expect(adopt.status, `${adopt.stdout}\n${adopt.stderr}`).toBe(0)
      const result = (
        JSON.parse(adopt.stdout) as { result: { dispatchId: string; terminal: string } }
      ).result
      expect(result.terminal).toBe(found.result.terminal.handle)
      adopted.push({ handle: found.result.terminal.handle, dispatchId: result.dispatchId, agent })
    }

    // Each member reports once under its own dispatch's capability.
    for (const [index, one] of adopted.entries()) {
      let capability: string | null = null
      await expect
        .poll(
          () => {
            const brief = one.agent
              .readStdin()
              .split(/(?=Your task ID is:)/)
              .find((part) => part.includes(one.dispatchId))
            capability =
              /--dispatch-capability (dcap_[A-Za-z0-9_-]+)/.exec(brief ?? '')?.[1] ?? null
            return capability
          },
          { timeout: 60_000, message: 'an adopted agent never got its dispatch capability' }
        )
        .not.toBeNull()
      await client.call(
        'orchestration.send',
        {
          from: one.handle,
          to: lead,
          type: 'status',
          subject: `report ${index + 1}`,
          body: 'Adopted and listening.',
          payload: JSON.stringify({ dispatchId: one.dispatchId })
        },
        { orchestrationCapability: capability! }
      )
    }

    let threads: GameInboxThreads | null = null
    await expect
      .poll(
        async () => {
          threads = (await client.call<GameInboxThreads>('game.inboxThreads', { worktreeId }))
            .result
          return Object.fromEntries(
            threads.threads.map((one) => [one.ticket, one.messages.map((m) => m.subject)])
          )
        },
        { timeout: 30_000 }
      )
      .toEqual({ 'e2e-secondary': ['report 1'], 'e2e-secondary 2': ['report 2'] })
    writeFileSync(testInfo.outputPath('threads.json'), JSON.stringify(threads, null, 2))

    await postLeadAgentRow(electronApp, { paneKey: pane.paneKey, worktreeId })
    const { inbox } = await openTeamInbox(orcaPage)
    await inbox.getByRole('tab', { name: /Threads/ }).click()
    await expect(inbox.getByTestId('game-inbox-thread-e2e-secondary')).toContainText('1 message')
    await expect(inbox.getByTestId('game-inbox-thread-e2e-secondary 2')).toContainText('1 message')
    await orcaPage.screenshot({ path: testInfo.outputPath('two-threads.png') })
  } finally {
    agents.forEach((one) => one.dispose())
  }
})
