import { spawnSync } from 'node:child_process'
import { chmod, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect } from './orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './agent-hook-endpoint'
import { BRIEF_LINE, memberDispatchOf, memberWorkspaceOf } from './game-member-workspace'
import type { StdinLoggingAgent } from './game-member-stdin-agent'
import { ensureTerminalVisible, waitForSessionReady } from './store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './terminal'
import { RuntimeClient } from '../../../src/cli/runtime-client'
import type { RuntimeTerminalListResult } from '../../../src/shared/runtime-types'

const cliEntry = path.join(process.cwd(), 'out', 'cli', 'index.js')

export type CliRun = { status: number | null; stdout: string; stderr: string }

/** The built `orca` CLI against this app, as `env`'s terminal would run it. */
export function runCli(userDataDir: string, env: Record<string, string>, args: string[]): CliRun {
  // Why: an Orca terminal running this spec exports its own handles, which must not leak in.
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('ORCA_'))
  )
  const run = spawnSync(process.execPath, [cliEntry, ...args], {
    env: { ...clean, ORCA_USER_DATA_PATH: userDataDir, ORCA_DEV_CLI_INVOCATION: '1', ...env },
    encoding: 'utf8',
    timeout: 90_000
  })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

export type GameLead = {
  client: RuntimeClient
  userDataDir: string
  handle: string
  worktreeId: string
  paneKey: string
  env: Record<string, string>
}

/** A registered lead on the active pane, running a foreground process so it reads as live. */
export async function startLead(
  electronApp: ElectronApplication,
  page: Page,
  agent: StdinLoggingAgent
): Promise<GameLead> {
  await waitForSessionReady(page)
  // Why an override: the login shell's PATH puts a real codex ahead of any fixture dir.
  await page.evaluate(async (command) => {
    await window.__store?.getState().updateSettings({
      uiLanguage: 'en',
      defaultTuiAgent: 'codex',
      agentCmdOverrides: { codex: command },
      agentDefaultArgs: { codex: '' }
    })
  }, agent.command)
  await ensureTerminalVisible(page)
  await waitForActivePanePtyId(page)
  const pane = await waitForActivePaneHookDescriptor(page)
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const client = new RuntimeClient(userDataDir, 30_000, null, null)
  let lead: { handle: string; worktreeId: string } | null = null
  await expect
    .poll(
      async () => {
        const resolved = await client
          .call<{ terminal: { handle: string } }>('terminal.resolvePane', {
            paneKey: pane.paneKey
          })
          .catch(() => null)
        const shown = resolved
          ? await client
              .call<{ terminal: { worktreeId: string } }>('terminal.show', {
                terminal: resolved.result.terminal.handle
              })
              .catch(() => null)
          : null
        lead =
          resolved && shown
            ? {
                handle: resolved.result.terminal.handle,
                worktreeId: shown.result.terminal.worktreeId
              }
            : null
        return lead !== null
      },
      { timeout: 60_000, message: 'the lead pane never resolved to a terminal' }
    )
    .toBe(true)
  const { handle, worktreeId } = lead!
  await client.call('terminal.send', {
    terminal: handle,
    text: 'node -e "setInterval(() => {}, 1e9)"',
    enter: true
  })
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
  // Why wait: a member's child worktree needs the lead's, which the first worktree scan lists.
  await waitForRuntimeWorktree(client, worktreeId)
  return {
    client,
    userDataDir,
    handle,
    worktreeId,
    paneKey: pane.paneKey,
    env: { ORCA_TERMINAL_HANDLE: handle, ORCA_WORKTREE_ID: worktreeId, ORCA_PANE_KEY: pane.paneKey }
  }
}

export type LaunchedMember = {
  ticket: string
  taskId: string
  handle: string
  brief: string
  paneKey: string
  worktreeId: string
}

/** `orca game launch` from the lead, and the brief the member was handed through its one line. */
export async function launchMember(
  lead: GameLead,
  agent: StdinLoggingAgent,
  ticket: string,
  launchAgent: 'codex' | 'claude' = 'codex'
): Promise<LaunchedMember> {
  const seen = new Set(
    [...agent.readStdin().matchAll(new RegExp(BRIEF_LINE.source, 'g'))].map((one) => one[1])
  )
  const launch = runCli(lead.userDataDir, lead.env, [
    'game',
    'launch',
    ticket,
    '--agent',
    launchAgent,
    '--json'
  ])
  expect(launch.status, `game launch ${ticket}\n${launch.stdout}\n${launch.stderr}`).toBe(0)
  const taskId = (JSON.parse(launch.stdout) as { result: { taskId: string } }).result.taskId
  let named: string | null = null
  await expect
    .poll(
      () => {
        const lines = [...agent.readStdin().matchAll(new RegExp(BRIEF_LINE.source, 'g'))]
        named = lines.map((one) => one[1]!).find((one) => !seen.has(one)) ?? null
        return named
      },
      { timeout: 60_000, message: `the ${ticket} member never received its one-line brief` }
    )
    .not.toBeNull()
  const workspace = await memberWorkspaceOf(lead.client, taskId)
  expect(workspace, `the ${ticket} member worktree is listed`).toBeTruthy()
  const brief = await readFile(path.join(workspace!, named!), 'utf8')
  const handle = (await memberDispatchOf(lead.client, taskId))?.assignee_handle
  expect(handle, `the ${ticket} dispatch has no member terminal`).toBeTruthy()
  const listed = await lead.client.call<RuntimeTerminalListResult>('terminal.list')
  const terminal = listed.result.terminals.find((one) => one.handle === handle)
  expect(terminal, `the ${ticket} terminal is not listed`).toBeTruthy()
  return {
    ticket,
    taskId,
    handle: handle!,
    brief,
    paneKey: `${terminal!.tabId}:${terminal!.leafId}`,
    worktreeId: terminal!.worktreeId
  }
}

/** What a real agent's own hooks post; the stdin agent has none, so the spec posts them for it. */
export async function postWorking(
  electronApp: ElectronApplication,
  panes: readonly { paneKey: string; worktreeId: string }[]
): Promise<void> {
  const endpoint = await readHookEndpoint(electronApp)
  for (const pane of panes) {
    await emitCodexHookStatus(endpoint, { ...pane, state: 'working', prompt: 'Work' })
  }
}

/** The member's worker_done, sent with the `--from` and capability its own brief gave it. */
export async function reportDone(
  lead: GameLead,
  member: LaunchedMember,
  outcome: 'succeeded' | 'failed',
  body: string,
  dir: string
): Promise<CliRun> {
  const field = (flag: string): string => {
    const value = new RegExp(`--${flag} (\\S+)`).exec(member.brief)?.[1]
    expect(value, `the ${member.ticket} brief names no --${flag}`).toBeTruthy()
    return value!
  }
  const envelopePath = path.join(dir, `${member.ticket}-envelope.json`)
  await writeFile(
    envelopePath,
    JSON.stringify({
      status: outcome === 'succeeded' ? 'success' : 'failed',
      summary: body,
      artifacts: [],
      verification: [],
      outOfScopeWrites: [],
      notesForNextAgent: body
    })
  )
  return runCli(lead.userDataDir, { ORCA_TERMINAL_HANDLE: member.handle }, [
    'orchestration',
    'send',
    '--from',
    field('from'),
    '--dispatch-capability',
    field('dispatch-capability'),
    '--type',
    'worker_done',
    '--subject',
    `${member.ticket} done`,
    '--body',
    body,
    '--task-id',
    member.taskId,
    '--dispatch-id',
    field('dispatch-id'),
    '--outcome',
    outcome,
    '--envelope-file',
    envelopePath
  ])
}

/**
 * A real plugin install, copied from this machine's Orca into the spec's: the content folder,
 * its `current` pointer and its lockfile entry, as the marketplace leaves them.
 */
export async function copyInstalledPlugin(
  installDir: string,
  userDataDir: string,
  pluginKey: string
): Promise<void> {
  const target = path.join(userDataDir, 'plugins', pluginKey)
  await mkdir(path.dirname(target), { recursive: true })
  await cp(installDir, target, { recursive: true })
  const lockPath = path.join(userDataDir, 'plugins', 'plugins.lock.json')
  const sourceLock = JSON.parse(
    await readFile(path.join(installDir, '..', 'plugins.lock.json'), 'utf8')
  ) as { plugins: Record<string, unknown> }
  const lock = await readFile(lockPath, 'utf8')
    .then((text) => JSON.parse(text) as { version: number; plugins: Record<string, unknown> })
    .catch(() => ({ version: 1, plugins: {} }))
  lock.plugins[pluginKey] = sourceLock.plugins[pluginKey]
  await writeFile(lockPath, JSON.stringify(lock, null, 2))
}

/** Turns the plugin system on, rediscovers, and approves every plugin waiting on consent. */
export async function enablePluginSystem(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const settings = await window.api.settings.set({ pluginSystemEnabled: true })
    window.__store?.setState({ settings })
    await window.api.plugins.refresh()
    for (const entry of await window.api.plugins.list()) {
      if (entry.consentFingerprint && entry.status !== 'idle' && entry.status !== 'running') {
        await window.api.plugins.consent({
          pluginKey: entry.pluginKey,
          reviewedFingerprint: entry.consentFingerprint,
          decision: 'approve'
        })
      }
    }
    return (await window.api.plugins.list()).map((entry) => `${entry.pluginKey}:${entry.status}`)
  })
}

/** A shell script running this checkout's built `orca` CLI against the spec's app. */
export async function writeRealCli(dir: string, userDataDir: string): Promise<string> {
  const cli = path.join(dir, 'orca-real-cli')
  await writeFile(
    cli,
    `#!/bin/sh\nORCA_USER_DATA_PATH='${userDataDir}' ORCA_DEV_CLI_INVOCATION=1 exec '${process.execPath}' '${cliEntry}' "$@"\n`
  )
  await chmod(cli, 0o755)
  return cli
}

/**
 * A fake agent named `claude`, since Orca adds the mod only to a direct claude command, that writes
 * the argv and ORCA_GAME_* env Orca started it with.
 */
export async function writeArgvLoggingAgent(
  dir: string,
  stdinAgent: StdinLoggingAgent
): Promise<{ command: string; launches: () => Promise<string> }> {
  const ledger = path.join(dir, 'launches.log')
  await mkdir(path.join(dir, 'bin'), { recursive: true })
  const command = path.join(dir, 'bin', 'claude')
  await writeFile(ledger, '')
  await writeFile(
    command,
    [
      `#!${process.execPath}`,
      "const fs = require('node:fs')",
      "const game = Object.entries(process.env).filter(([key]) => key.startsWith('ORCA_GAME_'))",
      `fs.appendFileSync(${JSON.stringify(ledger)}, JSON.stringify({ argv: process.argv.slice(2), env: Object.fromEntries(game) }) + '\\n')`,
      `require(${JSON.stringify(stdinAgent.command)})`,
      ''
    ].join('\n')
  )
  await chmod(command, 0o755)
  return { command, launches: () => readFile(ledger, 'utf8') }
}

/** Waits for the runtime's worktree scan, which can lag launch; workerStart resolves `id:` from it. */
export async function waitForRuntimeWorktree(
  client: RuntimeClient,
  worktreeId: string
): Promise<void> {
  await expect
    .poll(
      async () =>
        (
          await client.call<{ worktrees: { id: string }[] }>('worktree.list', {})
        ).result.worktrees.some((one) => one.id === worktreeId),
      { timeout: 60_000, message: "the runtime never listed the lead's worktree" }
    )
    .toBe(true)
}
