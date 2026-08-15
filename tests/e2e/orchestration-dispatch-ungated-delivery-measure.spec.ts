import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { ensureTerminalVisible, getActiveTabId, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import { ORCA_DISPATCH_STATUS_TASK_MARKER } from '../../src/shared/orca-dispatch-status-prompt'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

// Why (ORCA-208 re-measure): this reproduces the ticket's ORIGINAL instrument,
// not the guard spec next to it. The fake emits NO provable composer marker —
// no DECSET 2004, no show-cursor, no Codex glyph — so
// `AgentComposerReadinessTracker.wait` answers `unobserved` and returns in 0 ms,
// which is the ungated write path the 5/8 was measured on. The neighbouring
// `orchestration-dispatch-preamble-delivery.spec.ts` fake emits the handshake
// unconditionally, so its write is gated and it measured 8/8 in every direction.
//
// The instrument is the agent process's own stdin. A terminal buffer shows the
// tty echo, and the echo appears exactly when delivery did NOT happen (ORCA-207).
//
// One round per app launch by design: the handover being measured happens once,
// at pane spawn, against a freshly started daemon and shell.
const AGENT = process.env.ORCA_E2E_DISPATCH_AGENT ?? 'codex'
// Why: the positive control. With the handshake and the Codex glyph emitted,
// readiness resolves `ready`, the write is gated behind it, and the same ledger
// must record the whole preamble. A zero-byte round is only evidence of
// starvation if this variant is non-zero on the same instrument.
const EMIT_MARKER = process.env.ORCA_E2E_DISPATCH_EMIT_MARKER === '1'
// Where the per-round tally is written, so the driving loop can count rounds
// the spec itself failed. Absent, the round is only logged.
const OUTCOME_PATH = process.env.ORCA_E2E_DISPATCH_OUTCOME ?? ''

const fakeCliDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-ungated-delivery-'))
const ledgerPath = path.join(fakeCliDir, 'agent.jsonl')

// Why this exact shape: it is `orchestration-legacy-worker-missing-terminal-
// recovery.spec.ts`'s fake, verbatim, plus only the two additions the 5/8
// measurement made to it (docs/reference/orca-201-sync7-handoff.md, "a corrected
// fake that calls setRawMode(true) and answers on \r or \n"): raw mode, so
// nothing read can be tty echo, and a per-chunk stdin ledger.
//
// Keep the ORDER as it is, and do not tidy it: the title escape is written
// FIRST, at top level, and the tty is taken into raw mode only after. That gap
// is the window — the pane reads as a running agent while the shell still owns
// the tty. Hoisting `setRawMode` above the title would close the window inside
// the harness. Measured both ways here and the rate did not move, so the order
// is not what decides delivery; it is kept faithful so a future re-measurement
// starts from the original instrument rather than a tidied one.
const fakeAgentSource = `
const { appendFileSync } = require('node:fs')
const TASK_MARKER = ${JSON.stringify(ORCA_DISPATCH_STATUS_TASK_MARKER)}
const startedAt = Date.now()
function log(event, extra) {
  const target = process.env.ORCA_E2E_AGENT_LEDGER
  if (!target) return
  try {
    appendFileSync(
      target,
      JSON.stringify({ pid: process.pid, event, atMs: Date.now() - startedAt, ...extra }) + '\\n'
    )
  } catch {}
}
if (process.argv.slice(2).includes('app-server')) {
  process.stderr.write("error: unrecognized subcommand 'app-server'\\n")
  process.exit(2)
}
log('exec')
process.stdout.write('\\u001b]0;Codex Ready\\u0007OpenAI Codex\\nmodel: e2e\\ndirectory: e2e\\n')
log('titled')
if (process.env.ORCA_E2E_AGENT_EMIT_MARKER === '1') {
  process.stdout.write('\\u001b[?2004h')
  process.stdout.write('\\u203a ')
  process.stdout.write('\\u001b[?25l\\u276f \\u001b[37;3H\\u001b[?25h')
  log('composer-ready')
}
let rawMode = false
try {
  process.stdin.setRawMode(true)
  rawMode = true
} catch {}
log('raw-mode', { enabled: rawMode })
let acknowledged = false
process.stdin.on('data', (chunk) => {
  const input = chunk.toString()
  log('stdin', {
    bytes: Buffer.byteLength(chunk),
    rawMode,
    taskMarker: input.includes(TASK_MARKER)
  })
  if (!acknowledged && (input.includes('\\r') || input.includes('\\n'))) {
    acknowledged = true
    process.stdout.write('AGENT-STDOUT-ACK\\n')
  }
})
process.stdin.resume()
for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM']) {
  process.on(signal, () => process.exit(0))
}
setInterval(() => {}, 60_000)
`

if (process.platform === 'win32') {
  writeFileSync(path.join(fakeCliDir, 'fake-agent.js'), fakeAgentSource)
  for (const name of ['codex', 'claude']) {
    writeFileSync(
      path.join(fakeCliDir, `${name}.cmd`),
      '@echo off\r\nnode "%~dp0\\fake-agent.js" %*\r\n'
    )
  }
} else {
  for (const name of ['codex', 'claude']) {
    const executable = path.join(fakeCliDir, name)
    writeFileSync(executable, `#!/usr/bin/env node\n${fakeAgentSource}`)
    chmodSync(executable, 0o755)
  }
}

type LedgerEvent = {
  pid: number
  event: string
  atMs: number
  bytes?: number
  rawMode?: boolean
  taskMarker?: boolean
  enabled?: boolean
}

function readLedger(): LedgerEvent[] {
  if (!existsSync(ledgerPath)) {
    return []
  }
  return readFileSync(ledgerPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LedgerEvent)
}

type RoundOutcome = {
  pid: number
  bytes: number
  chunks: number
  taskMarker: boolean
  /** ms after exec that the first byte reached the process, or null if none did. */
  firstByteAtMs: number | null
  /** ms after exec that the process took the tty into raw mode. */
  rawModeAtMs: number | null
  /** ms after exec that the pane started reading as a running agent. */
  titledAtMs: number | null
  /** Corroboration only: the shell ran the preamble as a command line. */
  shellAteIt?: boolean
  /**
   * The tty echoed the preamble into the panel. Echo happens only in canonical
   * mode with ECHO on — Orca wrote before the agent took the tty. It is the
   * mutually-exclusive twin of delivery (ORCA-207).
   */
  echoedTaskMarker?: boolean
}

function outcomeFor(pid: number): RoundOutcome {
  const events = readLedger().filter((event) => event.pid === pid)
  const stdin = events.filter((event) => event.event === 'stdin')
  return {
    pid,
    chunks: stdin.length,
    bytes: stdin.reduce((total, event) => total + (event.bytes ?? 0), 0),
    taskMarker: stdin.some((event) => event.taskMarker === true),
    firstByteAtMs: stdin[0]?.atMs ?? null,
    rawModeAtMs: events.find((event) => event.event === 'raw-mode')?.atMs ?? null,
    titledAtMs: events.find((event) => event.event === 'titled')?.atMs ?? null
  }
}

let recorded = false

function recordOutcome(outcome: Record<string, unknown>): void {
  // Why: the measured round wins over the assertion failure it causes. Without
  // this, the catch below overwrites a real starvation with `harnessError`, and
  // a starved round would be indistinguishable from a launch that never ran.
  if (recorded) {
    return
  }
  recorded = true
  console.log(`[ORCA-208] ${JSON.stringify(outcome)}`)
  if (OUTCOME_PATH) {
    writeFileSync(OUTCOME_PATH, `${JSON.stringify(outcome)}\n`)
  }
}

test.describe.configure({ mode: 'serial' })

test.afterAll(() => {
  rmSync(fakeCliDir, { recursive: true, force: true })
})

test('the dispatched preamble reaches an unmarked agent process stdin', async (// oxlint-disable-next-line no-empty-pattern -- This spec owns its Electron launch.
{}, testInfo) => {
  test.setTimeout(240_000)
  rmSync(ledgerPath, { force: true })
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
    : ''
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

  const session = createRestartSession(testInfo, {
    PATH: `${fakeCliDir}${path.delimiter}${process.env.PATH ?? ''}`,
    ORCA_E2E_AGENT_LEDGER: ledgerPath,
    ORCA_E2E_AGENT_EMIT_MARKER: EMIT_MARKER ? '1' : '0'
  })
  let app: ElectronApplication | null = null

  try {
    const launched = await session.launch()
    app = launched.app
    await attachRepoAndOpenTerminal(launched.page, repoPath)
    await waitForSessionReady(launched.page)
    await ensureTerminalVisible(launched.page)
    await getActiveTabId(launched.page)
    await waitForActivePanePtyId(launched.page)
    const coordinatorPane = await waitForActivePaneHookDescriptor(launched.page)
    const client = new RuntimeClient(session.userDataDir, 90_000, null, null)
    const coordinator = await client.call<{ terminal: { handle: string } }>(
      'terminal.resolvePane',
      { paneKey: coordinatorPane.paneKey }
    )
    const coordinatorHandle = coordinator.result.terminal.handle
    const coordinatorTerminal = await client.call<{ terminal: { worktreeId: string } }>(
      'terminal.show',
      { terminal: coordinatorHandle }
    )
    await expect
      .poll(async () => {
        const listed = await client.call<{ worktrees: { id: string }[] }>('worktree.list', {})
        return listed.result.worktrees.some(
          (candidate) => candidate.id === coordinatorTerminal.result.terminal.worktreeId
        )
      })
      .toBe(true)

    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'ORCA-208 dispatch delivery re-measurement',
      from: coordinatorHandle
    })
    const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: 'Respond ACK and remain idle',
      run: run.result.run.id,
      callerTerminalHandle: coordinatorHandle
    })
    // Why the result is kept: a start that refuses to dispatch is a legitimate
    // outcome to measure, but it is a DIFFERENT outcome from bytes written and
    // lost. Counting them together would manufacture a starvation rate.
    let startResult: unknown = null
    let startError: string | null = null
    await client
      .call('orchestration.workerStart', {
        task: task.result.task.id,
        from: coordinatorHandle,
        agent: AGENT,
        // Why 15s: the value the recovery spec used for the original 5/8.
        timeoutMs: 15_000
      })
      .then((response) => {
        startResult = response.result
      })
      .catch((error) => {
        startError = String(error)
      })

    // Why raw mode and not the first `exec`: Orca invokes the agent binary more
    // than once per start, and the extra invocation runs on a pipe, where
    // `setRawMode` throws. Measuring the first pid measures a process that never
    // had a tty and so could never receive the preamble — a guaranteed zero.
    // The pane's process is the one that owns a tty.
    let pid: number | null = null
    await expect
      .poll(
        () => {
          pid =
            readLedger().findLast((event) => event.event === 'raw-mode' && event.enabled === true)
              ?.pid ?? null
          return pid
        },
        { timeout: 60_000 }
      )
      .not.toBeNull()

    // Why poll rather than sample once: a slow-but-complete delivery must not be
    // miscounted as starvation.
    await expect
      .poll(() => outcomeFor(pid!).taskMarker, { timeout: 20_000 })
      .toBe(true)
      .catch(() => undefined)

    const workers = await client.call<RuntimeTerminalListResult>('terminal.list')
    const worker = workers.result.terminals.find(
      (terminal) => terminal.title === 'Codex Ready' && terminal.handle !== coordinatorHandle
    )
    // Why: the panel is NOT the instrument — it is read only to tell a shell
    // that ate the preamble from bytes that queued canonically and arrived late.
    let panelTail = ''
    if (worker) {
      panelTail = await client
        .call<{ terminal: { tail: string[] } }>('terminal.read', {
          terminal: worker.handle,
          cursor: 0,
          limit: 1000
        })
        .then((read) => read.result.terminal.tail.join('\n'))
        .catch(() => '')
    }
    const outcome: RoundOutcome = {
      ...outcomeFor(pid!),
      shellAteIt: /command not found|not found:/i.test(panelTail),
      echoedTaskMarker: panelTail.includes(ORCA_DISPATCH_STATUS_TASK_MARKER)
    }
    const dispatch = await client
      .call<{ dispatch: unknown }>('orchestration.dispatchShow', { task: task.result.task.id })
      .then((response) => response.result.dispatch)
      .catch(() => null)
    recordOutcome({
      agent: AGENT,
      emitMarker: EMIT_MARKER,
      ...outcome,
      startResult,
      startError,
      dispatch,
      workerFound: Boolean(worker),
      panelTail: panelTail.slice(-4000),
      ledger: readLedger()
    })
    expect({ delivered: outcome.taskMarker, starved: outcome.bytes === 0 }).toEqual({
      delivered: true,
      starved: false
    })
  } catch (error) {
    recordOutcome({ agent: AGENT, harnessError: String(error) })
    throw error
  } finally {
    if (app) {
      await session.close(app).catch(() => undefined)
    }
    await session.dispose()
  }
})
