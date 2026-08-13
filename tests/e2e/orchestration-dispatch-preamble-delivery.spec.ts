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

// Why (ORCA-208): the only honest instrument for delivery is the agent process's
// own stdin. A terminal buffer shows the tty echo, and the echo appears exactly
// when delivery did NOT happen — reading the panel measures the opposite of what
// it looks like it measures (ORCA-207).
//
// Honest limit, stated up front: this spec is a GUARD, not a regression test.
// It passes on the tree before its own fix and on the tree before #83, so it is
// not evidence that any particular race is closed. What it does do is fail loudly
// if the dispatch write ever starts landing before the agent owns the tty.
//
// The fake agent boots in two stages on purpose. Stage 1 titles the pane and
// draws a banner while the tty is still canonical with echo on and nothing is
// reading it — the agent is already the foreground process by then, because the
// shell hands the pgrp over before execve. Stage 2 takes raw mode and runs the
// bracketed-paste handshake. A fake that does both in one tick leaves a window
// of microseconds, far narrower than Orca's ~10 ms write latency, and measures
// 8/8 whether or not the bug is present. The mount delay makes the ordering
// structural, the same way #83's real-zsh gate test uses a 3000 ms budget.
//
// Measured on this tree, 8 rounds per variant: the preamble reaches the process
// 1-3 ms after it enters raw mode, in every variant tried (codex with its
// marker, codex without, claude, mount delays of 300 ms and 3000 ms). Delivery
// tracks the agent's handshake, not a timer.

// Why: 3 in CI, 8 by hand. The measurement is a count, so the round budget is
// the knob — CI pays ~20 s a round and the failure mode it guards is not rare
// enough to need eight of them.
const ROUNDS = Number(process.env.ORCA_E2E_DISPATCH_DELIVERY_ROUNDS ?? '3')
// Why: `claude` by default. It is the class with no `draftPasteReadySignal`
// before this ticket, so it exercises the path that had no gate at all.
const AGENT = process.env.ORCA_E2E_DISPATCH_AGENT ?? 'claude'
const AGENT_BOOT_DELAY_MS = Number(process.env.ORCA_E2E_DISPATCH_AGENT_BOOT_DELAY_MS ?? '1500')
// Why: the Codex glyph, which only `codex` reads as its marker. Off by default
// because the default agent is `claude`, whose marker is the show-cursor the
// fake emits at the end of its composer frame either way.
const EMIT_COMPOSER_MARKER = process.env.ORCA_E2E_DISPATCH_AGENT_COMPOSER_MARKER === '1'
// Why: the gap between "the pane reads as a running agent" and "the TUI owns
// the tty". agent-composer-readiness.ts measures the real one at ~85 ms between
// the shell's DECRST and the agent's DECSET. Sized well above Orca's ~10 ms
// write latency so the ordering is structural, not a flake — the same reason
// #83's real-zsh gate test uses a 3000 ms budget.
const AGENT_MOUNT_DELAY_MS = Number(process.env.ORCA_E2E_DISPATCH_AGENT_MOUNT_DELAY_MS ?? '300')

const fakeCliDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-dispatch-delivery-'))
const ledgerPath = path.join(fakeCliDir, 'agent.jsonl')

const fakeCodexSource = `
const { appendFileSync } = require('node:fs')
const TASK_MARKER = ${JSON.stringify(ORCA_DISPATCH_STATUS_TASK_MARKER)}
const BOOT_DELAY_MS = Number(process.env.ORCA_E2E_AGENT_BOOT_DELAY_MS || '0')
const MOUNT_DELAY_MS = Number(process.env.ORCA_E2E_AGENT_MOUNT_DELAY_MS || '0')
const EMIT_COMPOSER_MARKER = process.env.ORCA_E2E_AGENT_COMPOSER_MARKER !== '0'
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
let rawMode = false
// Why: a real TUI does not touch stdin until its event loop mounts. Reading
// early would drain the tty queue and hide the very window under measurement.
setTimeout(() => {
  // Stage 1: the pane looks like a running agent — titled, banner drawn — while
  // the tty is still canonical with echo on and the process is not reading it.
  // This is the window ORCA-208 is about, and it is not hypothetical: the
  // shell hands the pgrp over before execve, so the agent is already the
  // foreground process here.
  process.stdout.write('\\u001b]0;Agent Ready\\u0007OpenAI Codex\\nmodel: e2e\\ndirectory: e2e\\n')
  log('titled')
  setTimeout(() => {
  // Stage 2: the TUI mounts — raw mode, then its own bracketed-paste handshake.
  try {
    process.stdin.setRawMode(true)
    rawMode = true
  } catch {}
  log('raw-mode', { enabled: rawMode })
  // Why: the handshake every provable marker is defined relative to.
  process.stdout.write('\\u001b[?2004h')
  log('bracketed-paste-on')
  // Why: mirrors the real ordering measured off a live claude PTY — the
  // composer row is drawn, the cursor is moved into it, and only then does the
  // frame end with DECTCEM show-cursor. Emitting the cursor first would assume
  // the very ordering the signal depends on.
  if (EMIT_COMPOSER_MARKER) {
    process.stdout.write('\\u203a ')
  }
  process.stdout.write('\\u001b[?25l❯ \\u001b[37;3H\\u001b[?25h')
  log('composer-ready')
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
      process.stdout.write('ACK\\n')
    }
  })
  process.stdin.resume()
  }, MOUNT_DELAY_MS)
}, BOOT_DELAY_MS)
for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM']) {
  process.on(signal, () => process.exit(0))
}
setInterval(() => {}, 60_000)
`

if (process.platform === 'win32') {
  writeFileSync(path.join(fakeCliDir, 'fake-codex.js'), fakeCodexSource)
  writeFileSync(
    path.join(fakeCliDir, 'codex.cmd'),
    '@echo off\r\nnode "%~dp0\\fake-codex.js" %*\r\n'
  )
} else {
  // Why: the same instrumented TUI is reachable under both names. `codex`
  // carries a provable `draftPasteReadySignal`; `claude` carries none, and that
  // configuration difference — not the process — is what decides whether the
  // dispatch write is gated at all.
  for (const name of ['codex', 'claude']) {
    const executable = path.join(fakeCliDir, name)
    writeFileSync(executable, `#!/usr/bin/env node\n${fakeCodexSource}`)
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
  /** Corroboration only: the shell ran the preamble as a command line. */
  shellAteIt?: boolean
  /**
   * The tty echoed the preamble into the panel. Echo happens only in canonical
   * mode with ECHO on — i.e. Orca wrote before the agent took the tty. It is
   * the mutually-exclusive twin of delivery (ORCA-207): its presence proves the
   * write raced the handover, whether or not the bytes happened to survive.
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
    rawModeAtMs: events.find((event) => event.event === 'raw-mode')?.atMs ?? null
  }
}

test.describe.configure({ mode: 'serial' })

test.afterAll(() => {
  rmSync(fakeCliDir, { recursive: true, force: true })
})

test('every dispatched preamble reaches the agent process stdin', async (// oxlint-disable-next-line no-empty-pattern -- This spec owns its Electron launch.
{}, testInfo) => {
  test.setTimeout(180_000 + ROUNDS * 60_000)
  rmSync(ledgerPath, { force: true })
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
    : ''
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

  const session = createRestartSession(testInfo, {
    PATH: `${fakeCliDir}${path.delimiter}${process.env.PATH ?? ''}`,
    ORCA_E2E_AGENT_LEDGER: ledgerPath,
    ORCA_E2E_AGENT_BOOT_DELAY_MS: String(AGENT_BOOT_DELAY_MS),
    ORCA_E2E_AGENT_MOUNT_DELAY_MS: String(AGENT_MOUNT_DELAY_MS),
    ORCA_E2E_AGENT_COMPOSER_MARKER: EMIT_COMPOSER_MARKER ? '1' : '0'
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
      {
        paneKey: coordinatorPane.paneKey
      }
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
      objective: 'ORCA-208 dispatch delivery measurement',
      from: coordinatorHandle
    })

    const outcomes: RoundOutcome[] = []
    for (let round = 0; round < ROUNDS; round += 1) {
      const seenPids = new Set(
        readLedger()
          .filter((event) => event.event === 'exec')
          .map((event) => event.pid)
      )
      const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
        spec: `Round ${round + 1}: respond ACK and remain idle`,
        run: run.result.run.id,
        callerTerminalHandle: coordinatorHandle
      })
      await client
        .call('orchestration.workerStart', {
          task: task.result.task.id,
          from: coordinatorHandle,
          agent: AGENT,
          timeoutMs: 45_000
        })
        // Why: a start that refuses to dispatch is a legitimate outcome to
        // measure, not a harness failure. The ledger still records what the
        // agent process did or did not receive.
        .catch(() => undefined)

      let pid: number | null = null
      await expect
        .poll(
          () => {
            pid =
              readLedger().find((event) => event.event === 'exec' && !seenPids.has(event.pid))
                ?.pid ?? null
            return pid
          },
          { timeout: 45_000 }
        )
        .not.toBeNull()

      // Why: poll until the preamble settles rather than sampling once, so a
      // slow-but-complete delivery is not miscounted as a partial one.
      await expect
        .poll(() => outcomeFor(pid!).taskMarker, { timeout: 20_000 })
        .toBe(true)
        .catch(() => undefined)
      const workers = await client.call<RuntimeTerminalListResult>('terminal.list')
      const worker = workers.result.terminals.find(
        (terminal) => terminal.title === 'Agent Ready' && terminal.handle !== coordinatorHandle
      )
      // Why: the panel is NOT the instrument (its echo appears exactly when
      // delivery failed) — it is read only to tell a shell that ate the
      // preamble (command-not-found spew) from bytes that queued canonically
      // and arrived late. Those are different bugs.
      let panelTail = ''
      if (worker) {
        panelTail = await client
          .call<{ terminal: { tail: string[] } }>('terminal.read', {
            terminal: worker.handle,
            limit: 200
          })
          .then((read) => read.result.terminal.tail.join('\n'))
          .catch(() => '')
      }
      outcomes.push({
        ...outcomeFor(pid!),
        shellAteIt: /command not found|not found:/i.test(panelTail),
        echoedTaskMarker: panelTail.includes(ORCA_DISPATCH_STATUS_TASK_MARKER)
      })
      if (worker) {
        await client.call('terminal.close', { terminal: worker.handle }).catch(() => undefined)
      }
    }

    const delivered = outcomes.filter((outcome) => outcome.taskMarker)
    const starved = outcomes.filter((outcome) => outcome.bytes === 0)
    // Why: the per-round ledger IS this spec's deliverable — a pass/fail alone
    // does not carry the counts the ticket asks for.
    console.log(
      `[ORCA-208] rounds=${outcomes.length} delivered=${delivered.length} starved=${starved.length} ${JSON.stringify(outcomes)}`
    )
    expect({
      rounds: outcomes.length,
      delivered: delivered.length,
      starved: starved.length
    }).toEqual({ rounds: ROUNDS, delivered: ROUNDS, starved: 0 })
  } finally {
    if (app) {
      await session.close(app).catch(() => undefined)
    }
    await session.dispose()
  }
})
