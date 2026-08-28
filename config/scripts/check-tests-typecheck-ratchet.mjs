import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// Ratchet gate for `tsc -p tests/tsconfig.json`.
//
// tests/ was in no tsconfig project, so `npm run typecheck` never read the E2E
// suite: a missing import could only surface as a runtime ReferenceError deep
// inside a sharded job (ORCA-318). The project now exists, and the errors it
// already finds are frozen per file. New errors fail; fixed ones must be
// ratcheted down. The baseline may only SHRINK.
//
// Per file, not a single total, so a new error in one spec cannot hide behind
// someone else's fix in another.

const BASELINE_PATH = 'config/tests-typecheck-baseline.txt'
const PROJECT_PATH = 'tests/tsconfig.json'
const ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error TS\d+:/

export function parseErrorCounts(tscOutput) {
  const counts = new Map()
  for (const line of tscOutput.split(/\r?\n/)) {
    const match = ERROR_LINE.exec(line)
    if (!match) {
      continue
    }
    const file = match[1].replaceAll('\\', '/')
    counts.set(file, (counts.get(file) ?? 0) + 1)
  }
  return counts
}

export function parseBaseline(text) {
  const counts = new Map()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const match = /^(\d+)\s+(.+)$/.exec(line)
    if (match) {
      counts.set(match[2], Number(match[1]))
    }
  }
  return counts
}

export function formatBaseline(counts) {
  const header = [
    '# Per-file TypeScript error counts under tests/tsconfig.json.',
    '# This is a RATCHET: counts may only SHRINK, and a file may only leave the list.',
    '# Do NOT raise a number or add a file to get CI green — fix the error instead',
    '# (ORCA-318). When you fix one, lower its count here; when a file reaches zero,',
    '# delete its line so re-introducing an error is blocked.',
    ''
  ]
  const rows = [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([file, count]) => `${count} ${file}`)
  return `${[...header, ...rows].join('\n')}\n`
}

export function diffAgainstBaseline(current, baseline) {
  const regressions = []
  const improvements = []
  for (const [file, count] of current) {
    const allowed = baseline.get(file) ?? 0
    if (count > allowed) {
      regressions.push({ file, count, allowed })
    } else if (count < allowed) {
      improvements.push({ file, count, allowed })
    }
  }
  for (const [file, allowed] of baseline) {
    if (!current.has(file)) {
      improvements.push({ file, count: 0, allowed })
    }
  }
  const sort = (rows) => rows.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
  return { regressions: sort(regressions), improvements: sort(improvements) }
}

export function totalOf(counts) {
  let total = 0
  for (const count of counts.values()) {
    total += count
  }
  return total
}

function runProject(root) {
  const tsc = process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
  const result = spawnSync(
    path.join(root, 'node_modules', '.bin', tsc),
    ['--noEmit', '-p', PROJECT_PATH],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  if (result.error) {
    throw result.error
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`
}

function printRegressions(regressions, total, baselineTotal) {
  for (const { file, count, allowed } of regressions) {
    console.error(`::error file=${file}::${count} TypeScript error(s), baseline allows ${allowed}`)
  }
  console.error('')
  console.error('╭────────────────────────────────────────────────────────────────────────────╮')
  console.error('│  ❌  New TypeScript errors under tests/                                      │')
  console.error('╰────────────────────────────────────────────────────────────────────────────╯')
  console.error('')
  console.error(`  ${total} error(s) now, baseline allows ${baselineTotal}.`)
  console.error('')
  for (const { file, count, allowed } of regressions) {
    console.error(`    • ${file}\n        ↳ ${allowed} allowed, ${count} found`)
  }
  console.error('')
  console.error(`  Reproduce: npx tsc --noEmit -p ${PROJECT_PATH}`)
  console.error('')
  console.error('  ✅  Fix the error. Do NOT raise the baseline to get CI green: the whole point')
  console.error('      of this gate is that a missing import fails here in seconds instead of as')
  console.error('      a ReferenceError 17 minutes into a sharded E2E job (ORCA-318).')
  console.error('')
}

function printImprovements(improvements, counts) {
  for (const { file, count, allowed } of improvements) {
    console.error(`::error file=${file}::${count} error(s) now, baseline still allows ${allowed}`)
  }
  console.error('')
  console.error('╭────────────────────────────────────────────────────────────────────────────╮')
  console.error('│  ⚠️  tests/ typecheck baseline is out of date — nice work fixing errors!      │')
  console.error('╰────────────────────────────────────────────────────────────────────────────╯')
  console.error('')
  console.error('  The baseline may only shrink, so it has to record the improvement or the')
  console.error('  errors you fixed could come back unnoticed:')
  console.error('')
  for (const { file, count, allowed } of improvements) {
    console.error(`    • ${file}\n        ↳ ${allowed} → ${count}`)
  }
  console.error('')
  console.error('  ✅  Fix it: node config/scripts/check-tests-typecheck-ratchet.mjs --write')
  console.error('')
  void counts
}

function main() {
  const root = process.cwd()
  const write = process.argv.includes('--write')
  const baselineFile = path.join(root, BASELINE_PATH)
  const current = parseErrorCounts(runProject(root))
  const total = totalOf(current)

  if (write) {
    fs.writeFileSync(baselineFile, formatBaseline(current))
    console.log(
      `Wrote ${BASELINE_PATH}: ${total} error(s) across ${current.size} file(s) under ${PROJECT_PATH}.`
    )
    return
  }

  const baseline = fs.existsSync(baselineFile)
    ? parseBaseline(fs.readFileSync(baselineFile, 'utf8'))
    : new Map()
  const baselineTotal = totalOf(baseline)
  const { regressions, improvements } = diffAgainstBaseline(current, baseline)

  if (regressions.length > 0) {
    printRegressions(regressions, total, baselineTotal)
    process.exit(1)
  }
  if (improvements.length > 0) {
    printImprovements(improvements, current)
    process.exit(1)
  }

  // Why the count on success: the size of the backlog is the argument for
  // burning it down, and nobody re-runs a green gate to find out.
  console.log(
    `tests/ typecheck ratchet OK — ${total} known error(s) across ${current.size} file(s) ` +
      `still to fix under ${PROJECT_PATH}; the baseline blocks any new one.`
  )
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
