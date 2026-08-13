import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test as base, expect } from './helpers/orca-app'
import {
  ensureTerminalVisible,
  getActiveTabId,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { RuntimeTerminalListResult, RuntimeTerminalRead } from '../../src/shared/runtime-types'

const fakeCliDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-worker-stdout-read-'))
const processLedgerPath = path.join(fakeCliDir, 'process.jsonl')
// Why not 'ACK': the dispatch preamble quotes the task spec ("Respond ACK…"),
// so a bare ACK assertion is satisfied by tty echo of Orca's own write (ORCA-207).
const REPLY_MARKER = 'AGENT-STDOUT-ACK'

// Why: raw mode removes tty echo, so anything the read returns had to come from
// this process's own stdout — the echo/participation confusion of ORCA-207.
const fakeCodexSource = `
const { appendFileSync } = require('node:fs')
function appendLedger(event) {
  const ledgerPath = process.env.ORCA_E2E_PROCESS_LEDGER
  if (!ledgerPath) return
  try {
    appendFileSync(ledgerPath, JSON.stringify({ pid: process.pid, at: Date.now(), ...event }) + '\\n')
  } catch {}
}
function emit(text) {
  process.stdout.write(text)
  appendLedger({ event: 'stdout', text })
}
if (process.argv.slice(2).includes('app-server')) {
  process.stderr.write("error: unrecognized subcommand 'app-server'\\n")
  process.exit(2)
}
appendLedger({ event: 'spawn' })
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
  appendLedger({ event: 'raw-mode' })
}
emit('\\u001b]0;Codex Ready\\u0007OpenAI Codex\\nmodel: e2e\\ndirectory: e2e\\n')
let acknowledged = false
process.stdin.on('data', (chunk) => {
  const input = chunk.toString()
  appendLedger({ event: 'stdin', bytes: chunk.length, hasTaskMarker: input.includes('=== TASK ===') })
  if (!acknowledged && (input.includes('\\r') || input.includes('\\n'))) {
    acknowledged = true
    emit('${REPLY_MARKER}\\n')
  }
})
process.stdin.resume()
setInterval(() => {}, 60_000)
`

const executable = path.join(fakeCliDir, 'codex')
if (process.platform === 'win32') {
  writeFileSync(path.join(fakeCliDir, 'fake-codex.js'), fakeCodexSource)
  writeFileSync(
    path.join(fakeCliDir, 'codex.cmd'),
    '@echo off\r\nnode "%~dp0\\fake-codex.js" %*\r\n'
  )
} else {
  writeFileSync(executable, `#!/usr/bin/env node\n${fakeCodexSource}`)
  chmodSync(executable, 0o755)
}

const test = base.extend({
  launchEnv: [
    {
      PATH: `${fakeCliDir}${path.delimiter}${process.env.PATH ?? ''}`,
      ORCA_E2E_PROCESS_LEDGER: processLedgerPath
    },
    { option: true }
  ]
})

test.afterAll(() => {
  rmSync(fakeCliDir, { recursive: true, force: true })
})

type ProcessLedgerEvent = {
  pid: number
  at: number
  event: 'spawn' | 'raw-mode' | 'stdout' | 'stdin'
  text?: string
  bytes?: number
  hasTaskMarker?: boolean
}

function readProcessLedger(): ProcessLedgerEvent[] {
  if (!existsSync(processLedgerPath)) {
    return []
  }
  return readFileSync(processLedgerPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ProcessLedgerEvent)
}

function stdoutWrote(marker: string): boolean {
  return readProcessLedger().some(
    (entry) => entry.event === 'stdout' && (entry.text ?? '').includes(marker)
  )
}

test('a worker agent that owns the tty has its own stdout in terminal.read', async ({
  orcaPage,
  electronApp
}) => {
  rmSync(processLedgerPath, { force: true })
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  expect(await getActiveTabId(orcaPage)).toBeTruthy()
  await waitForActivePanePtyId(orcaPage)
  const coordinatorPane = await waitForActivePaneHookDescriptor(orcaPage)
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const client = new RuntimeClient(userDataDir, 30_000, null, null)
  const coordinator = await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
    paneKey: coordinatorPane.paneKey
  })
  const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
    objective: 'Read a worker agent stdout back through terminal.read',
    from: coordinator.result.terminal.handle
  })
  const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
    spec: 'Respond ACK and remain idle',
    run: run.result.run.id,
    callerTerminalHandle: coordinator.result.terminal.handle
  })
  const coordinatorTerminal = await client.call<{ terminal: { worktreeId: string } }>(
    'terminal.show',
    { terminal: coordinator.result.terminal.handle }
  )
  await expect
    .poll(async () => {
      const listed = await client.call<{ worktrees: { id: string }[] }>('worktree.list', {})
      return listed.result.worktrees.some(
        (worktree) => worktree.id === coordinatorTerminal.result.terminal.worktreeId
      )
    })
    .toBe(true)
  await client.call('orchestration.workerStart', {
    task: task.result.task.id,
    from: coordinator.result.terminal.handle,
    agent: 'codex',
    timeoutMs: 15_000
  })

  let worker: RuntimeTerminalListResult['terminals'][number] | undefined
  await expect
    .poll(async () => {
      const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
      worker = listed.result.terminals.find((terminal) => terminal.title === 'Codex Ready')
      return worker?.ptyId ?? null
    })
    .toBeTruthy()

  // Process truth first: the banner left the agent's stdout before any read.
  await expect.poll(() => stdoutWrote('OpenAI Codex')).toBe(true)

  const readTail = async (): Promise<string> => {
    const read = await client.call<{ terminal: RuntimeTerminalRead }>('terminal.read', {
      terminal: worker!.handle,
      limit: 200
    })
    return read.result.terminal.tail.join('\n')
  }

  // Why: the banner rides the same single write as the OSC title Orca parsed to
  // find this pane, so a read missing it is supervision going blind on a live
  // agent — not a PTY or spawn failure.
  await expect
    .poll(readTail, { message: `process ledger: ${JSON.stringify(readProcessLedger())}` })
    .toContain('OpenAI Codex')

  // The reply to the dispatch preamble: process truth first (delivery is
  // ORCA-208/ORCA-210's question), then the same read visibility.
  await expect.poll(() => stdoutWrote(REPLY_MARKER), { timeout: 20_000 }).toBe(true)
  await expect
    .poll(readTail, { message: `process ledger: ${JSON.stringify(readProcessLedger())}` })
    .toContain(REPLY_MARKER)
})
