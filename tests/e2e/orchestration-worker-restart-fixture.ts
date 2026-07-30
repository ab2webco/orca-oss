import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_LOCAL_ORCA_PROFILE_ID } from '../../src/shared/orca-profiles'

export const PROVIDER_SESSION_ID = 'e2e-legacy-orchestration-worker'
export const fakeCliDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-legacy-worker-'))
export const spawnLedgerPath = path.join(fakeCliDir, 'spawn.jsonl')
export const interruptionLedgerPath = path.join(fakeCliDir, 'interruption.jsonl')
export const authorityLedgerPath = path.join(fakeCliDir, 'authority.jsonl')
export const lifecycleLedgerPath = path.join(fakeCliDir, 'lifecycle.jsonl')
const fakeCodexSource = `
const { appendFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
function appendLedger(envName, event) {
  const ledgerPath = process.env[envName]
  if (!ledgerPath) return
  try {
    appendFileSync(ledgerPath, JSON.stringify({ pid: process.pid, at: Date.now(), ...event }) + '\\n')
  } catch {}
}
async function emitAuthorityHook() {
  const port = process.env.ORCA_AGENT_HOOK_PORT
  const token = process.env.ORCA_AGENT_HOOK_TOKEN
  const launchToken = process.env.ORCA_AGENT_LAUNCH_TOKEN
  if (!port || !token || !launchToken || !process.env.ORCA_PANE_KEY) return
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/hook/codex', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Orca-Agent-Hook-Token': token
      },
      body: JSON.stringify({
        paneKey: process.env.ORCA_PANE_KEY,
        tabId: process.env.ORCA_TAB_ID,
        worktreeId: process.env.ORCA_WORKTREE_ID,
        env: process.env.ORCA_AGENT_HOOK_ENV,
        version: process.env.ORCA_AGENT_HOOK_VERSION,
        launchToken,
        payload: {
          hook_event_name: 'UserPromptSubmit',
          prompt: 'Respond ACK and remain idle'
        }
      })
    })
    appendLedger('ORCA_E2E_AUTHORITY_LEDGER', { event: 'authority-hook', status: response.status })
  } catch (error) {
    appendLedger('ORCA_E2E_AUTHORITY_LEDGER', {
      event: 'authority-hook-error',
      error: error instanceof Error ? error.message : String(error)
    })
  }
}
if (process.argv.slice(2).includes('app-server')) {
  process.stderr.write("error: unrecognized subcommand 'app-server'\\n")
  process.exit(2)
}
appendLedger('ORCA_E2E_SPAWN_LEDGER', { event: 'spawn', argv: process.argv.slice(2) })
process.stdout.write('\\u001b]0;Codex Ready\\u0007OpenAI Codex\\nmodel: e2e\\ndirectory: e2e\\n')
void emitAuthorityHook()
let acknowledged = false
let lifecycleSent = false
let receivedInput = ''
let dispatchCapability = null
process.stdin.on('data', (chunk) => {
  const input = chunk.toString()
  receivedInput = (receivedInput + input).slice(-16_384)
  dispatchCapability =
    receivedInput.match(/--dispatch-capability (dcap_[A-Za-z0-9_-]+)/)?.[1] ?? dispatchCapability
  if (input.includes('\\x03')) {
    appendLedger('ORCA_E2E_INTERRUPTION_LEDGER', { event: 'stdin-ctrl-c' })
  }
  if (!acknowledged && input.includes('\\r')) {
    acknowledged = true
    process.stdout.write('ACK\\n')
  }
  const legacyCompletion = input.match(/ORCA_E2E_RUN_LEGACY_DONE:([A-Za-z0-9+/=]+)/)
  if (!lifecycleSent && legacyCompletion) {
    lifecycleSent = true
    const identity = JSON.parse(Buffer.from(legacyCompletion[1], 'base64').toString('utf8'))
    const cliEntry = process.env.ORCA_E2E_CLI_ENTRY
    const args = [
      'orchestration',
      'send',
      '--to',
      identity.coordinatorHandle,
      '--type',
      'worker_done',
      '--subject',
      'Completed',
      '--body',
      'E2E retained legacy completion',
      '--payload',
      JSON.stringify({
        taskId: identity.taskId,
        dispatchId: identity.dispatchId,
        filesModified: []
      }),
      '--json'
    ]
    const result = cliEntry
      ? spawnSync(process.execPath, [cliEntry, ...args], {
          env: process.env,
          encoding: 'utf8'
        })
      : { status: 127, stdout: '', stderr: 'ORCA_E2E_CLI_ENTRY missing' }
    appendLedger('ORCA_E2E_LIFECYCLE_LEDGER', {
      event: 'legacy-command',
      argv: args,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr
    })
    process.stdout.write(String(result.stdout || '') + String(result.stderr || ''))
  }
  const currentCompletion = input.match(/ORCA_E2E_RUN_CURRENT_DONE:([A-Za-z0-9+/=]+)/)
  if (!lifecycleSent && currentCompletion && dispatchCapability) {
    lifecycleSent = true
    const identity = JSON.parse(Buffer.from(currentCompletion[1], 'base64').toString('utf8'))
    const cliEntry = process.env.ORCA_E2E_CLI_ENTRY
    const args = [
      'orchestration',
      'send',
      '--from',
      identity.terminalHandle,
      '--dispatch-capability',
      dispatchCapability,
      '--type',
      'worker_done',
      '--subject',
      'Completed',
      '--body',
      'E2E retained current completion',
      '--task-id',
      identity.taskId,
      '--dispatch-id',
      identity.dispatchId,
      '--outcome',
      'succeeded',
      '--files-modified',
      '',
      '--json'
    ]
    const result = cliEntry
      ? spawnSync(process.execPath, [cliEntry, ...args], {
          env: process.env,
          encoding: 'utf8'
        })
      : { status: 127, stdout: '', stderr: 'ORCA_E2E_CLI_ENTRY missing' }
    appendLedger('ORCA_E2E_LIFECYCLE_LEDGER', {
      event: 'current-command',
      argv: args,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr
    })
    process.stdout.write(String(result.stdout || '') + String(result.stderr || ''))
  }
})
for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM']) {
  process.on(signal, () => {
    appendLedger('ORCA_E2E_INTERRUPTION_LEDGER', { event: 'signal', signal })
    process.exit(0)
  })
}
process.stdin.resume()
setInterval(() => {}, 60_000)
`

if (process.platform === 'win32') {
  writeFileSync(path.join(fakeCliDir, 'fake-codex.js'), fakeCodexSource)
  writeFileSync(
    path.join(fakeCliDir, 'codex.cmd'),
    '@echo off\r\nnode "%~dp0\\fake-codex.js" %*\r\n'
  )
} else {
  const executable = path.join(fakeCliDir, 'codex')
  writeFileSync(executable, `#!/usr/bin/env node\n${fakeCodexSource}`)
  chmodSync(executable, 0o755)
}

type LedgerEvent = {
  pid: number
  event: string
  argv?: string[]
  signal?: string
  status?: number
  stdout?: string
  stderr?: string
  error?: string
}

type PersistedWorkspaceSession = {
  activeTabId?: string | null
  activeTabIdByWorktree?: Record<string, string | null>
  tabsByWorktree?: Record<string, { id: string }[]>
  terminalLayoutsByTabId?: Record<string, unknown>
  unifiedTabs?: Record<string, { id: string; entityId: string }[]>
  tabGroups?: Record<
    string,
    { activeTabId: string | null; tabOrder: string[]; recentTabIds?: string[] }[]
  >
  sleepingAgentSessionsByPaneKey?: Record<
    string,
    { providerSession?: { id?: unknown }; automaticResumeBlockedBy?: string }
  >
  terminalPtyIncarnationsByPaneKey?: Record<string, string>
  terminalSurfaceTombstonesByPaneKey?: Record<string, unknown>
}

type PersistedData = {
  workspaceSession?: PersistedWorkspaceSession
}

export function readLedger(ledgerPath: string): LedgerEvent[] {
  if (!existsSync(ledgerPath)) {
    return []
  }
  return readFileSync(ledgerPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LedgerEvent)
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function persistedDataPath(userDataDir: string): string {
  return path.join(userDataDir, 'profiles', DEFAULT_LOCAL_ORCA_PROFILE_ID, 'orca-data.json')
}

function readPersistedData(userDataDir: string): PersistedData {
  return JSON.parse(readFileSync(persistedDataPath(userDataDir), 'utf8')) as PersistedData
}

export function hasPersistedResumeRecord(userDataDir: string, paneKey: string): boolean {
  return (
    readPersistedData(userDataDir).workspaceSession?.sleepingAgentSessionsByPaneKey?.[paneKey]
      ?.providerSession?.id === PROVIDER_SESSION_ID
  )
}

export function stripLegacyWorkerRendererBinding(
  userDataDir: string,
  input: {
    worktreeId: string
    coordinatorTabId: string
    workerTabId: string
    workerPaneKey: string
  }
): void {
  const data = readPersistedData(userDataDir)
  const session = data.workspaceSession
  if (!session) {
    throw new Error('Expected a persisted workspace session')
  }
  const sleeping = session.sleepingAgentSessionsByPaneKey?.[input.workerPaneKey]
  if (sleeping?.providerSession?.id !== PROVIDER_SESSION_ID) {
    throw new Error('Expected the legacy worker resume record before removing its tab binding')
  }
  session.tabsByWorktree = {
    ...session.tabsByWorktree,
    [input.worktreeId]: (session.tabsByWorktree?.[input.worktreeId] ?? []).filter(
      (tab) => tab.id !== input.workerTabId
    )
  }
  delete session.terminalLayoutsByTabId?.[input.workerTabId]
  if (session.unifiedTabs?.[input.worktreeId]) {
    session.unifiedTabs[input.worktreeId] = session.unifiedTabs[input.worktreeId].filter(
      (tab) => tab.id !== input.workerTabId && tab.entityId !== input.workerTabId
    )
  }
  for (const group of session.tabGroups?.[input.worktreeId] ?? []) {
    group.tabOrder = group.tabOrder.filter((tabId) => tabId !== input.workerTabId)
    group.recentTabIds = group.recentTabIds?.filter((tabId) => tabId !== input.workerTabId)
    if (group.activeTabId === input.workerTabId) {
      group.activeTabId = input.coordinatorTabId
    }
  }
  session.activeTabId = input.coordinatorTabId
  session.activeTabIdByWorktree = {
    ...session.activeTabIdByWorktree,
    [input.worktreeId]: input.coordinatorTabId
  }
  delete session.terminalPtyIncarnationsByPaneKey?.[input.workerPaneKey]
  delete session.terminalSurfaceTombstonesByPaneKey?.[input.workerPaneKey]
  writeFileSync(persistedDataPath(userDataDir), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export function resetWorkerRestartLedgers(): void {
  for (const ledgerPath of [
    spawnLedgerPath,
    interruptionLedgerPath,
    authorityLedgerPath,
    lifecycleLedgerPath
  ]) {
    rmSync(ledgerPath, { force: true })
  }
}

export function disposeWorkerRestartFixture(): void {
  rmSync(fakeCliDir, { recursive: true, force: true })
}
