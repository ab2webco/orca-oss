import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { cleanupE2EDaemons } from './helpers/electron-process-shutdown'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { BRIEF_LINE, memberWorkspaceOf } from './helpers/game-member-workspace'
import { ensureTerminalVisible, waitForSessionReady, waitForActiveWorktree } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

const TICKET = 'E2E-702'
const cliEntry = path.join(process.cwd(), 'out', 'cli', 'index.js')

type LeadPane = { paneKey: string; handle: string; worktreeId: string }

type ResumeJson = {
  result: { members: { ticket: string; result: string; dispatchId?: string; reason?: string }[] }
}

function runCli(userDataDir: string, env: Record<string, string>, args: string[]) {
  const { ORCA_ENVIRONMENT: _e, ORCA_PAIRING_CODE: _p, ...clean } = process.env
  void _e
  void _p
  return spawnSync(process.execPath, [cliEntry, ...args], {
    env: { ...clean, ORCA_USER_DATA_PATH: userDataDir, ORCA_DEV_CLI_INVOCATION: '1', ...env },
    encoding: 'utf8',
    timeout: 60_000
  })
}

// Why polled: the restored lead pane binds a terminal handle a moment after the window loads.
async function resolveLead(client: RuntimeClient, paneKey: string): Promise<LeadPane> {
  let lead: LeadPane | null = null
  await expect
    .poll(
      async () => {
        try {
          const pane = await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
            paneKey
          })
          const shown = await client.call<{ terminal: { worktreeId: string } }>('terminal.show', {
            terminal: pane.result.terminal.handle
          })
          lead = {
            paneKey,
            handle: pane.result.terminal.handle,
            worktreeId: shown.result.terminal.worktreeId
          }
        } catch {
          lead = null
        }
        return lead !== null
      },
      { timeout: 60_000, message: 'the lead pane never resolved to a terminal' }
    )
    .toBe(true)
  return lead!
}

const readLeadState = async (client: RuntimeClient, lead: LeadPane) =>
  (
    await client.call<OrchestratorGameState>('game.state', {
      worktreeId: lead.worktreeId,
      terminalHandle: lead.handle,
      paneKey: lead.paneKey
    })
  ).result

function readMembersFile(userDataDir: string): { members: { ticket: string }[] } | null {
  const dir = path.join(userDataDir, 'orchestrator-game-members')
  const file = existsSync(dir)
    ? readdirSync(dir).find((name) => name.endsWith('.members.json'))
    : undefined
  return file ? JSON.parse(readFileSync(path.join(dir, file), 'utf8')) : null
}

test('a game member paused by a real restart is resumed on its own task and can report done', async ({
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
  let firstApp: ElectronApplication | null = null
  let secondApp: ElectronApplication | null = null

  try {
    const first = await session.launch()
    firstApp = first.app
    const worktreeId = await attachRepoAndOpenTerminal(first.page, repoPath)
    await waitForSessionReady(first.page)
    // Why an override: the login shell's PATH puts a real codex ahead of any fixture dir.
    await first.page.evaluate(async (command) => {
      await window.__store?.getState().updateSettings({
        defaultTuiAgent: 'codex',
        agentCmdOverrides: { codex: command },
        agentDefaultArgs: { codex: '' }
      })
    }, agent.command)
    await ensureTerminalVisible(first.page)
    await waitForActivePanePtyId(first.page)
    const leadPane = await waitForActivePaneHookDescriptor(first.page)
    const firstClient = new RuntimeClient(session.userDataDir, 30_000, null, null)
    const firstLead = await resolveLead(firstClient, leadPane.paneKey)

    const run = await firstClient.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Game member resume after restart',
      from: firstLead.handle
    })
    const task = await firstClient.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: 'Stay idle and wait',
      taskTitle: TICKET,
      run: run.result.run.id,
      callerTerminalHandle: firstLead.handle
    })
    const caller = { worktreeId: firstLead.worktreeId, terminalHandle: firstLead.handle }
    await firstClient.call('game.memberRecord', {
      ...caller,
      member: {
        ticket: TICKET,
        name: TICKET,
        runId: run.result.run.id,
        taskId: task.result.task.id,
        agent: 'codex',
        lastState: 'launching'
      }
    })
    // Why warm first: a slow CI run had already cached the repo's scan, which hid the new worktree.
    await expect
      .poll(async () =>
        (
          await firstClient.call<{ worktrees: { id: string }[] }>('worktree.list', {})
        ).result.worktrees.map((one) => one.id)
      )
      .toContain(worktreeId)
    // Why created here: the seeded repo's primary worktree is external, which new-child cannot parent.
    const memberWorktreeId = await first.page.evaluate(async (name) => {
      const state = window.__store?.getState()
      const active = Object.values(state?.worktreesByRepo ?? {})
        .flat()
        .find((worktree) => worktree.id === state?.activeWorktreeId)
      if (!state || !active) {
        throw new Error('active worktree was not found')
      }
      return (await state.createWorktree(active.repoId, name)).worktree.id
    }, TICKET.toLowerCase())
    await expect
      .poll(async () =>
        firstClient.call('worktree.show', { worktree: `id:${memberWorktreeId}` }).then(
          () => true,
          () => false
        )
      )
      .toBe(true)
    const started = await firstClient.call<{
      dispatchId: string
      effects: { kind: string; role?: string; id?: string }[]
    }>('orchestration.workerStart', {
      task: task.result.task.id,
      from: firstLead.handle,
      worktree: `id:${memberWorktreeId}`,
      displayName: TICKET,
      agent: 'codex',
      timeoutMs: 20_000
    })
    const memberHandle = started.result.effects.find(
      (effect) => effect.kind === 'terminal' && effect.role === 'agent'
    )?.id
    expect(memberHandle, 'workerStart opened no agent terminal').toBeTruthy()
    await firstClient.call('game.memberRecord', {
      ...caller,
      member: {
        ticket: TICKET,
        dispatchId: started.result.dispatchId,
        worktreeId: memberWorktreeId,
        lastState: 'working'
      }
    })

    // The stub reports no hooks, so the member's agent row is posted the way Orca's hooks do.
    const listed = await firstClient.call<RuntimeTerminalListResult>('terminal.list')
    const memberTerminal = listed.result.terminals.find((one) => one.handle === memberHandle)
    expect(memberTerminal, 'the member terminal is not listed').toBeTruthy()
    const endpoint = await readHookEndpoint(first.app)
    const postMemberHook = (): Promise<void> =>
      emitCodexHookStatus(endpoint, {
        paneKey: `${memberTerminal!.tabId}:${memberTerminal!.leafId}`,
        worktreeId: memberTerminal!.worktreeId,
        state: 'working',
        prompt: 'Stay idle and wait'
      })

    // AC1: a lead's game.state read saves the live member.
    await expect
      .poll(
        async () => {
          await postMemberHook()
          const state = await readLeadState(firstClient, firstLead)
          return {
            live: state.agents.some((agent) => agent.isMember === true),
            paused: state.pausedMembers ?? null
          }
        },
        { timeout: 30_000, message: 'the lead never saw its live member' }
      )
      .toEqual({ live: true, paused: [] })
    expect(readMembersFile(session.userDataDir)?.members.map((one) => one.ticket)).toEqual([TICKET])

    // A real restart: the app quits and the daemon holding the agent's process goes with it.
    await session.close(firstApp)
    firstApp = null
    await cleanupE2EDaemons(session.userDataDir)

    const second = await session.launch()
    secondApp = second.app
    await waitForSessionReady(second.page)
    expect(await waitForActiveWorktree(second.page)).toBe(worktreeId)
    const secondClient = new RuntimeClient(session.userDataDir, 30_000, null, null)
    const secondLead = await resolveLead(secondClient, leadPane.paneKey)

    // AC2: after the restart the lead lists the ticket as paused, not as a live member.
    let afterRestart: OrchestratorGameState | null = null
    await expect
      .poll(
        async () => {
          afterRestart = await readLeadState(secondClient, secondLead)
          return afterRestart.pausedMembers?.map((one) => one.ticket) ?? null
        },
        { timeout: 60_000, message: 'the member never showed as paused after the restart' }
      )
      .toEqual([TICKET])
    await testInfo.attach('paused-members.json', {
      body: JSON.stringify(
        { pausedMembers: afterRestart!.pausedMembers, file: readMembersFile(session.userDataDir) },
        null,
        2
      ),
      contentType: 'application/json'
    })
    expect(afterRestart!.pausedMembersError).toBeUndefined()
    expect(afterRestart!.agents.filter((agent) => agent.isMember === true)).toEqual([])
    expect(afterRestart!.pausedMembers![0]).toMatchObject({
      ticket: TICKET,
      runId: run.result.run.id
    })

    // AC3: resume-members starts a NEW dispatch on the member's own task.
    const leadEnv = {
      ORCA_TERMINAL_HANDLE: secondLead.handle,
      ORCA_PANE_KEY: secondLead.paneKey,
      ORCA_WORKTREE_ID: secondLead.worktreeId
    }
    // Why an offset: the first launch's dispatch capability is in the same ledger.
    const stdinBeforeResume = agent.readStdin().length
    const resumed = runCli(session.userDataDir, leadEnv, ['game', 'resume-members', '--json'])
    expect(resumed.status, resumed.stderr || resumed.stdout).toBe(0)
    const outcome = (JSON.parse(resumed.stdout) as ResumeJson).result.members
    expect(outcome).toEqual([
      expect.objectContaining({
        ticket: TICKET,
        result: 'relaunched',
        dispatchId: expect.any(String)
      })
    ])
    const newDispatchId = outcome[0].dispatchId!
    expect(newDispatchId).not.toBe(started.result.dispatchId)
    const dispatch = await secondClient.call<{
      dispatch: { id: string; task_id: string; status: string; assignee_handle: string } | null
    }>('orchestration.dispatchShow', { task: task.result.task.id })
    expect(dispatch.result.dispatch).toMatchObject({
      id: newDispatchId,
      task_id: task.result.task.id
    })
    const current = await secondClient.call<{ run: { id: string } | null }>(
      'orchestration.runCurrent',
      { from: secondLead.handle }
    )
    expect(current.result.run?.id).toBe(run.result.run.id)

    // AC5: a worker_done under the new dispatch's capability settles the task in the lead's run.
    const newHandle = dispatch.result.dispatch!.assignee_handle
    // Why the file: a game member is typed one line naming its brief, which holds the capability.
    const memberPath = await memberWorkspaceOf(secondClient, task.result.task.id)
    let capability: string | null = null
    await expect
      .poll(
        async () => {
          const named = BRIEF_LINE.exec(agent.readStdin().slice(stdinBeforeResume))?.[1]
          const brief =
            named && memberPath ? readFileSync(path.join(memberPath, named), 'utf8') : ''
          capability = /--dispatch-capability (dcap_[A-Za-z0-9_-]+)/.exec(brief)?.[1] ?? null
          return capability
        },
        { timeout: 60_000, message: 'the relaunched agent never received its dispatch capability' }
      )
      .not.toBeNull()
    const done = runCli(session.userDataDir, { ORCA_TERMINAL_HANDLE: newHandle }, [
      'orchestration',
      'send',
      '--from',
      newHandle,
      '--dispatch-capability',
      capability!,
      '--type',
      'worker_done',
      '--subject',
      'Completed',
      '--body',
      'E2E resumed member done',
      '--task-id',
      task.result.task.id,
      '--dispatch-id',
      newDispatchId,
      '--outcome',
      'succeeded',
      '--files-modified',
      '',
      '--envelope',
      JSON.stringify({
        status: 'success',
        summary: 'The resumed member settled its task.',
        verification: [
          { claim: 'the resumed member reported done', evidence: 'e2e worker_done', level: 'unit' }
        ]
      }),
      '--json'
    ])
    expect(done.status, done.stderr || done.stdout).toBe(0)
    await expect
      .poll(async () => {
        const tasks = await secondClient.call<{ tasks: { id: string; status: string }[] }>(
          'orchestration.taskList',
          { run: run.result.run.id }
        )
        return tasks.result.tasks.find((one) => one.id === task.result.task.id)?.status
      })
      .toBe('completed')
  } finally {
    if (secondApp) {
      await session.close(secondApp)
    }
    if (firstApp) {
      await session.close(firstApp)
    }
    await session.dispose()
    agent.dispose()
  }
})
