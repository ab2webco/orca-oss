import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { createBriefReadingAgent } from './helpers/game-member-brief-agent'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'

// A launched member is typed one line naming its brief, and acts on the file alone (ORCA-757).
const cliEntry = path.join(process.cwd(), 'out', 'cli', 'index.js')

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

type DispatchRow = { id: string; assignee_handle: string | null; last_heartbeat_at: string | null }

test('a launched member reads its one-line brief and sends the start heartbeat for its dispatch', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(240_000)
  const agent = createBriefReadingAgent(cliEntry)
  try {
    await waitForSessionReady(orcaPage)
    // Why an override: the login shell's PATH puts a real codex ahead of any fixture dir.
    await orcaPage.evaluate(async (command) => {
      await window.__store?.getState().updateSettings({
        agentCmdOverrides: { codex: command },
        agentDefaultArgs: { codex: '' }
      })
    }, agent.command)
    await ensureTerminalVisible(orcaPage)
    await waitForActivePanePtyId(orcaPage)
    const leadPane = await waitForActivePaneHookDescriptor(orcaPage)
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = new RuntimeClient(userDataDir, 30_000, null, null)

    let lead: { handle: string; worktreeId: string } | null = null
    await expect
      .poll(
        async () => {
          const pane = await client
            .call<{ terminal: { handle: string } }>('terminal.resolvePane', {
              paneKey: leadPane.paneKey
            })
            .catch(() => null)
          const shown = pane
            ? await client
                .call<{ terminal: { worktreeId: string } }>('terminal.show', {
                  terminal: pane.result.terminal.handle
                })
                .catch(() => null)
            : null
          lead =
            pane && shown
              ? {
                  handle: pane.result.terminal.handle,
                  worktreeId: shown.result.terminal.worktreeId
                }
              : null
          return lead !== null
        },
        { timeout: 60_000, message: 'the lead pane never resolved to a terminal' }
      )
      .toBe(true)
    // Why wait: a member's child worktree needs the lead's, which the first worktree scan lists.
    await expect
      .poll(
        async () =>
          (
            await client.call<{ worktrees: { id: string }[] }>('worktree.list', {})
          ).result.worktrees.some((one) => one.id === lead!.worktreeId),
        { timeout: 60_000, message: "the runtime never listed the lead's worktree" }
      )
      .toBe(true)
    const launch = runCli(
      userDataDir,
      {
        ORCA_TERMINAL_HANDLE: lead!.handle,
        ORCA_WORKTREE_ID: lead!.worktreeId,
        ORCA_PANE_KEY: leadPane.paneKey
      },
      ['game', 'launch', 'E2E-757', '--agent', 'codex', '--json']
    )
    expect(launch.status, `${launch.stdout}\n${launch.stderr}`).toBe(0)
    const launched = JSON.parse(launch.stdout) as { result: { taskId: string } }

    await expect
      .poll(() => agent.readHeartbeats().length, {
        timeout: 90_000,
        message: `the member never acted on a brief; it was typed: ${agent.readStdin().slice(0, 400)}`
      })
      .toBeGreaterThan(0)
    const [heartbeat] = agent.readHeartbeats()
    writeFileSync(testInfo.outputPath('heartbeat.json'), JSON.stringify(heartbeat, null, 2))
    expect(heartbeat!.status, heartbeat!.stderr).toBe(0)

    // What the member was typed: the line, never the capability or the task block.
    const typed = agent.readStdin()
    writeFileSync(testInfo.outputPath('typed.txt'), typed)
    expect(typed).toContain(
      `Read your Orca Lab brief at ${heartbeat!.named} (task ${launched.result.taskId})`
    )
    expect(typed).not.toContain('dcap_')
    expect(typed).not.toContain('=== TASK ===')

    const dispatchOf = async () =>
      (
        await client.call<{ dispatch: DispatchRow | null }>('orchestration.dispatchShow', {
          task: launched.result.taskId
        })
      ).result.dispatch
    const dispatch = (await dispatchOf())!
    expect(heartbeat!.args).toContain(dispatch.id)
    await expect
      .poll(async () => (await dispatchOf())?.last_heartbeat_at ?? null, {
        timeout: 30_000,
        message: 'Orca never recorded the start heartbeat on the launched dispatch'
      })
      .not.toBeNull()

    // The brief itself, on the member's own workspace.
    const memberTerminal = await client.call<{ terminal: { worktreeId: string } }>(
      'terminal.show',
      {
        terminal: dispatch.assignee_handle
      }
    )
    const worktrees = await client.call<{ worktrees: { id: string; path: string }[] }>(
      'worktree.list',
      {}
    )
    const memberPath = worktrees.result.worktrees.find(
      (one) => one.id === memberTerminal.result.terminal.worktreeId
    )?.path
    expect(memberPath, 'the member worktree is listed').toBeTruthy()
    const brief = readFileSync(path.join(memberPath!, heartbeat!.named), 'utf8')
    writeFileSync(testInfo.outputPath('brief.md'), brief)
    expect(brief).toContain(`--task-id ${launched.result.taskId} --dispatch-id ${dispatch.id}`)
    expect(brief).toMatch(/--dispatch-capability dcap_/)
    expect(brief).toContain('=== TASK ===')
    expect(brief).toContain('E2E-757')

    // Why: a member that commits with `git add -A` must not take its brief along.
    const status = spawnSync('git', ['-C', memberPath!, 'status', '--porcelain'], {
      encoding: 'utf8'
    })
    expect(status.stdout).not.toContain('.orca')
  } finally {
    agent.dispose()
  }
})
