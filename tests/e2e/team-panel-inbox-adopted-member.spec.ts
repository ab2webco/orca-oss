import { writeFileSync } from 'node:fs'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { openTeamInbox, postLeadAgentRow } from './helpers/team-panel-inbox'
import { runOrcaCli } from './helpers/orca-cli-process'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { GameInboxThreads } from '../../src/shared/orchestrator-game-inbox-threads'

const WIDTHS = [1440, 768, 390, 320]
const ADOPTED = 'Pixel'

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    window.__store?.setState({ settings })
  }, theme)
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

// An agent adopted with `game adopt` has no ticket: its rows name it, and its mail has a thread (ORCA-1136).
test('the Inbox names an adopted member, gives it a thread, and credits the person for an answer', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(360_000)
  const agent = createStdinLoggingAgent()
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
    await orcaPage.evaluate(async (command) => {
      await window.__store?.getState().updateSettings({
        defaultTuiAgent: 'codex',
        agentCmdOverrides: { codex: command },
        agentDefaultArgs: { codex: '' }
      })
    }, agent.command)
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
    // Why wait: workerStart and the adopt seat need both worktrees, which the first scan lists.
    // Why by branch: earlier specs in the run leave worktrees whose folders are gone.
    let otherWorktreeId: string | undefined
    await expect
      .poll(
        async () => {
          const { worktrees } = (
            await client.call<{ worktrees: { id: string; repoId: string; branch: string }[] }>(
              'worktree.list',
              {}
            )
          ).result
          const repoId = worktrees.find((one) => one.id === worktreeId)?.repoId
          otherWorktreeId = worktrees.find(
            (one) =>
              one.repoId === repoId && one.branch.replace(/^refs\/heads\//, '') === 'e2e-secondary'
          )?.id
          return otherWorktreeId
        },
        { timeout: 60_000, message: 'the runtime never listed the seeded e2e-secondary worktree' }
      )
      .toBeTruthy()
    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Adopted member Inbox',
      from: lead
    })

    // A launched member shares the Run, so its mail must stay apart from the adopted one's.
    const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: 'Work on ORCA-12',
      taskTitle: 'ORCA-12',
      run: run.result.run.id,
      callerTerminalHandle: lead
    })
    const launched = await client.call<{
      effects: { kind: string; role?: string; id?: string }[]
    }>('orchestration.workerStart', {
      task: task.result.task.id,
      from: lead,
      worktree: `id:${worktreeId}`,
      displayName: 'ORCA-12',
      agent: 'codex',
      timeoutMs: 20_000
    })
    const busy = launched.result.effects.find(
      (effect) => effect.kind === 'terminal' && effect.role === 'agent'
    )?.id
    expect(busy, 'workerStart opened no agent terminal for ORCA-12').toBeTruthy()

    // The agent to adopt: started by hand in this project's other worktree, idle at its prompt.
    const found = await client.call<{ terminal: { handle: string; paneKey: string } }>(
      'terminal.create',
      { worktree: `id:${otherWorktreeId}`, title: ADOPTED, command: agent.command }
    )
    const endpoint = await readHookEndpoint(electronApp)
    await emitCodexHookStatus(endpoint, {
      paneKey: found.result.terminal.paneKey,
      worktreeId: otherWorktreeId!,
      state: 'working',
      prompt: 'Polish the scene'
    })
    await emitCodexHookStatus(endpoint, {
      paneKey: found.result.terminal.paneKey,
      worktreeId: otherWorktreeId!,
      state: 'done',
      lastAssistantMessage: 'Done.'
    })
    const cli = (args: string[]) =>
      runOrcaCli(
        userDataDir,
        { ORCA_TERMINAL_HANDLE: lead, ORCA_WORKTREE_ID: worktreeId, ORCA_PANE_KEY: pane.paneKey },
        args
      )
    let fleet = ''
    let name: string | null = null
    await expect
      .poll(
        () => {
          const state = cli(['game', 'state', '--json'])
          fleet = state.stdout || state.stderr
          writeFileSync(testInfo.outputPath('fleet.json'), fleet)
          const agents = (JSON.parse(fleet || '{}') as { result?: { agents?: unknown[] } }).result
            ?.agents as { found?: boolean; terminalHandle?: string; displayName?: string }[]
          name =
            agents?.find((one) => one.found && one.terminalHandle === found.result.terminal.handle)
              ?.displayName ?? null
          return name
        },
        { timeout: 60_000, message: 'the hand-started agent never showed as found' }
      )
      .not.toBeNull()
    writeFileSync(testInfo.outputPath('fleet.json'), fleet)
    const adopt = cli(['game', 'adopt', name!, '--force', '--json'])
    writeFileSync(testInfo.outputPath('adopt.txt'), `${adopt.stdout}\n${adopt.stderr}`)
    expect(adopt.status, `${adopt.stdout}\n${adopt.stderr}`).toBe(0)
    const adopted = (JSON.parse(adopt.stdout) as { result: { dispatchId: string } }).result
    expect(adopted.dispatchId).toBeTruthy()

    // Why its preamble: only the adopted dispatch's own capability may ask its lead.
    let capability: string | null = null
    await expect
      .poll(
        () => {
          // Why per brief: both members log to one ledger, each brief starting at its task line.
          const brief = agent
            .readStdin()
            .split(/(?=Your task ID is:)/)
            .find((one) => one.includes(adopted.dispatchId))
          capability = /--dispatch-capability (dcap_[A-Za-z0-9_-]+)/.exec(brief ?? '')?.[1] ?? null
          return capability
        },
        { timeout: 60_000, message: 'the adopted agent never got its dispatch capability' }
      )
      .not.toBeNull()
    const memberCall = (method: string, params: Record<string, unknown>) =>
      client.call(method, params, { orchestrationCapability: capability! })
    await memberCall('orchestration.send', {
      from: found.result.terminal.handle,
      to: lead,
      type: 'status',
      subject: 'member ready',
      body: 'Adopted and listening.',
      payload: JSON.stringify({ dispatchId: adopted.dispatchId })
    })
    await client.call('orchestration.send', {
      from: busy,
      to: lead,
      type: 'status',
      subject: 'Step 1 of the arcade',
      body: 'Progress.'
    })
    const ask = memberCall('orchestration.ask', {
      from: found.result.terminal.handle,
      question: 'Which scene should I polish first?',
      timeoutMs: 240_000
    })

    const read = async () =>
      (await client.call<GameInboxThreads>('game.inboxThreads', { worktreeId })).result
    let questionId: string | undefined
    await expect
      .poll(async () => {
        questionId = (await read()).waiting.find((one) => one.body.includes('Which scene'))?.id
        return questionId
      })
      .toBeTruthy()
    const threads = await read()
    writeFileSync(testInfo.outputPath('threads.json'), JSON.stringify(threads, null, 2))
    expect(JSON.stringify(threads)).not.toContain('dispatch:')
    const own = threads.threads.find((one) => one.ticket === name)
    expect(own?.messages.map((one) => one.subject)).toContain('member ready')
    expect(threads.threads.find((one) => one.ticket === 'ORCA-12')?.messages).not.toContainEqual(
      expect.objectContaining({ subject: 'member ready' })
    )

    await postLeadAgentRow(electronApp, { paneKey: pane.paneKey, worktreeId })
    const { inbox } = await openTeamInbox(orcaPage)
    const captureEveryWidth = async (shot: string): Promise<void> => {
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        for (const theme of ['dark', 'light'] as const) {
          await setTheme(orcaPage, theme)
          await orcaPage.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(`${shot}-${width}-${theme}.png`)
          })
        }
      }
      await orcaPage.setViewportSize({ width: 1440, height: 900 })
    }

    await inbox.getByRole('tab', { name: /Waiting/ }).click()
    const row = inbox.getByTestId(`team-inbox-waiting-${questionId}`)
    await expect(row).toContainText(`${name}: Which scene should I polish first?`)
    await expect(row).not.toContainText('ctx_')
    await captureEveryWidth('adopted-waiting')

    await inbox.getByRole('tab', { name: /Threads/ }).click()
    await expect(inbox.getByTestId(`game-inbox-thread-${name}`)).toContainText('2 messages')
    await captureEveryWidth('adopted-threads')
    await inbox.getByTestId(`game-inbox-thread-${name}`).click()
    await expect(inbox.getByTestId('game-inbox-thread-messages')).toContainText('member ready')
    await captureEveryWidth('adopted-thread')
    await inbox.getByRole('button', { name: /All threads/ }).click()

    // The person answers it: the member's ask returns their words, and Answered says so.
    await inbox.getByRole('tab', { name: /Waiting/ }).click()
    await row.getByRole('button', { name: 'Answer' }).click()
    const box = row.getByRole('textbox')
    await box.fill('The harbor first')
    await box.press('Enter')
    expect(JSON.stringify(await ask)).toContain('The harbor first')
    await inbox.getByRole('tab', { name: /Answered/ }).click()
    const answered = inbox.getByTestId(`team-inbox-answered-${questionId}`)
    await expect(answered).toContainText('You answered: The harbor first')
    await expect(answered).not.toContainText('The lead answered')
    await captureEveryWidth('adopted-answered')
  } finally {
    agent.dispose()
  }
})
