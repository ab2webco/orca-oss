#!/usr/bin/env node
/**
 * Runs vitest and, after a bounded stretch of silence, names what is wedged
 * before the job's `timeout-minutes` kills it anonymously (ORCA-257).
 *
 * Every argument is forwarded to `vitest run` byte for byte — the shard
 * partition is a function of the include/exclude set, so changing it would
 * change which files land where.
 *
 * Usage: node config/scripts/run-vitest-with-hang-watchdog.mjs <vitest run args...>
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { HANG_JOURNAL_ENV, readHangJournalSummary } from './vitest-hang-journal.mjs'
import {
  VITEST_HANG_ANNOTATION_TITLE,
  VITEST_HANG_BLOCK_HEADER,
  VITEST_HANG_EXIT_CODE
} from './vitest-hang-marker.mjs'

const scriptDir = import.meta.dirname
const repoRoot = resolve(scriptDir, '..', '..')

// 3x hookTimeout (60s), the ceiling on a legitimately quiet worker; basis in ORCA-257.
const DEFAULT_IDLE_SECONDS = 180

// Grace for the workers to answer SIGUSR2 with their active handles.
const PROBE_GRACE_MS = 2_000

function readIdleSeconds() {
  const raw = process.env.ORCA_VITEST_HANG_IDLE_SECONDS
  if (!raw) {
    return DEFAULT_IDLE_SECONDS
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`ORCA_VITEST_HANG_IDLE_SECONDS must be a positive number, got "${raw}"`)
  }
  return parsed
}

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`
}

/** Descendants of `rootPid`, deepest last, as `ps` reports them. */
function describeProcessTree(rootPid) {
  if (process.platform === 'win32') {
    return ['(process tree unavailable on win32)']
  }
  const listed = spawnSync('ps', ['ax', '-o', 'pid=,ppid=,stat=,etime=,args='], {
    encoding: 'utf8'
  })
  if (listed.status !== 0 || !listed.stdout) {
    return ['(ps produced no output)']
  }
  const rows = []
  for (const line of listed.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line)
    if (match) {
      rows.push({ pid: Number(match[1]), ppid: Number(match[2]), line: line.trim() })
    }
  }
  const wanted = new Set([rootPid])
  let grew = true
  while (grew) {
    grew = false
    for (const row of rows) {
      if (!wanted.has(row.pid) && wanted.has(row.ppid)) {
        wanted.add(row.pid)
        grew = true
      }
    }
  }
  const tree = rows.filter((row) => wanted.has(row.pid)).map((row) => row.line)
  return tree.length > 0 ? tree : ['(no surviving processes)']
}

function reportHang({ journalPath, idleMs, childPid }) {
  const summary = readHangJournalSummary(journalPath)
  const now = Date.now()
  const lines = []
  lines.push(
    `::error title=${VITEST_HANG_ANNOTATION_TITLE}::No output for ${formatSeconds(idleMs)}; the run is wedged, not slow.`
  )
  lines.push('')
  lines.push(VITEST_HANG_BLOCK_HEADER)
  lines.push(`silence: ${formatSeconds(idleMs)}`)
  lines.push(`verdict: ${summary.verdict}`)
  lines.push(`modules: ${summary.endedCount} finished of ${summary.plannedCount} planned`)

  if (summary.verdict === 'teardown-hang') {
    lines.push(
      `run-end reported "${summary.runEndReason}" — every module finished and the process still would not exit; look at the handles below, not at a test.`
    )
  } else if (summary.verdict === 'wedged-modules') {
    lines.push('modules that reached a worker and never finished:')
    for (const suspect of summary.suspects) {
      const phase =
        suspect.startedAtMs === null ? 'never started (blocked while loading)' : 'running'
      const since = suspect.startedAtMs ?? suspect.queuedAtMs
      lines.push(`  ${suspect.module} — ${phase}, ${formatSeconds(now - since)} ago`)
    }
  } else if (summary.verdict === 'no-journal') {
    lines.push(`no journal at ${journalPath} — the reporter never ran, so no module can be named.`)
  } else {
    lines.push(
      'no module was in flight and the run never ended — the stall is outside module execution.'
    )
  }

  lines.push('')
  lines.push('surviving process tree:')
  for (const row of describeProcessTree(childPid)) {
    lines.push(`  ${row}`)
  }
  lines.push('')
  lines.push(
    'worker handles (SIGUSR2 replies follow; a synchronously blocked worker cannot answer):'
  )
  lines.push('==============================')
  process.stderr.write(`${lines.join('\n')}\n`)
}

function signalGroup(pid, signal) {
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal)
  } catch {
    // Already gone.
  }
}

async function main() {
  const forwarded = process.argv.slice(2)
  const idleMs = readIdleSeconds() * 1000
  const journalDir = mkdtempSync(join(tmpdir(), 'orca-vitest-hang-'))
  const journalPath = join(journalDir, 'modules.jsonl')
  const vitestBin =
    process.env.ORCA_VITEST_BIN ?? join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs')
  const reporterPath = join(scriptDir, 'vitest-hang-journal-reporter.mjs')

  const child = spawn(
    process.execPath,
    [vitestBin, 'run', ...forwarded, '--reporter=default', `--reporter=${reporterPath}`],
    {
      cwd: repoRoot,
      env: { ...process.env, [HANG_JOURNAL_ENV]: journalPath },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    }
  )

  let lastOutputMs = Date.now()
  let firing = false
  child.stdout.on('data', (chunk) => {
    lastOutputMs = Date.now()
    process.stdout.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    lastOutputMs = Date.now()
    process.stderr.write(chunk)
  })

  const forwardSignal = (signal) => signalGroup(child.pid, signal)
  process.on('SIGINT', forwardSignal)
  process.on('SIGTERM', forwardSignal)

  const exitCode = await new Promise((resolveExit) => {
    const poll = setInterval(() => {
      if (firing || Date.now() - lastOutputMs < idleMs) {
        return
      }
      firing = true
      clearInterval(poll)
      reportHang({ journalPath, idleMs: Date.now() - lastOutputMs, childPid: child.pid })
      signalGroup(child.pid, 'SIGUSR2')
      setTimeout(() => {
        signalGroup(child.pid, 'SIGKILL')
        resolveExit(VITEST_HANG_EXIT_CODE)
      }, PROBE_GRACE_MS)
    }, 1_000)

    child.on('error', (error) => {
      clearInterval(poll)
      process.stderr.write(
        `run-vitest-with-hang-watchdog: could not spawn vitest — ${error.message}\n`
      )
      resolveExit(2)
    })
    child.on('exit', (code, signal) => {
      if (firing) {
        return
      }
      clearInterval(poll)
      resolveExit(signal ? 128 : (code ?? 1))
    })
  })

  rmSync(journalDir, { recursive: true, force: true })
  process.exit(exitCode)
}

try {
  await main()
} catch (error) {
  process.stderr.write(
    `run-vitest-with-hang-watchdog: ${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exit(2)
}
