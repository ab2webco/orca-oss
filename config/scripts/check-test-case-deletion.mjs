#!/usr/bin/env node
// A suite gets greener when tests are deleted, so "N passed" cannot tell a fix from a
// removal. This compares how many `it`/`test` cases the tree declares against a base ref.
//
// It compares TOTALS, not files. Upstream splits a suite into several files constantly, so
// per-file comparison reads a split as the original losing every case — measured on a sync
// branch, that produced 59 false positives against zero real deletions.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// An empty argv slot reaches here as '' from `pnpm run … -- "$SHA"` when the SHA is
// missing, and git then answers with its usage text rather than an error.
const requestedRef = (process.argv[2] ?? '').trim()
const baseRef = requestedRef === '' ? 'origin/main' : requestedRef

const allowlistPath = fileURLToPath(new URL('../deleted-test-cases.txt', import.meta.url))
const CASE_LINE = '^[[:space:]]*(it|test)(\\.[a-zA-Z]+)?[[:space:]]*\\('
const TEST_GLOBS = ['*.test.ts', '*.test.tsx', '*.test.mjs', '*.spec.ts', '*.spec.tsx']

const allowed = new Set(
  existsSync(allowlistPath)
    ? readFileSync(allowlistPath, 'utf8')
        .split('\n')
        .map((line) => line.replace(/#.*$/, '').trim())
        .filter(Boolean)
    : []
)

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
}

// `git grep -c` reports one count per file in a single pass — a per-file `git show` spawned
// a process for every test file and took minutes on this repo.
function casesByPath(ref) {
  let output = ''
  try {
    output = git(['grep', '-c', '-E', CASE_LINE, ...(ref ? [ref] : []), '--', ...TEST_GLOBS])
  } catch {
    return new Map() // grep exits non-zero when nothing matches
  }
  const totals = new Map()
  for (const line of output.split('\n')) {
    if (line === '') {
      continue
    }
    const body = ref ? line.slice(line.indexOf(':') + 1) : line
    const split = body.lastIndexOf(':')
    const path = body.slice(0, split)
    if (!allowed.has(path)) {
      totals.set(path, Number(body.slice(split + 1)))
    }
  }
  return totals
}

// Why skip rather than fail: a checkout without the merge target — a fork clone, a shallow
// CI fetch — cannot compute a comparison, and a gate that fails there teaches people to
// pass it a ref at random until it goes quiet.
try {
  git(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`])
} catch {
  console.log(`Test case deletion check skipped — ${baseRef} is not present in this checkout.`)
  process.exit(0)
}

const before = casesByPath(baseRef)
const after = casesByPath(null)
const sum = (totals) => [...totals.values()].reduce((total, count) => total + count, 0)
const lost = sum(before) - sum(after)

if (lost > 0) {
  const shrank = [...before]
    .filter(([path, count]) => (after.get(path) ?? 0) < count)
    .map(([path, count]) => `${path}: ${count} → ${after.get(path) ?? 0}`)
  console.error(`Test cases were removed: ${sum(before)} → ${sum(after)} (${lost} fewer).`)
  console.error('Files whose own count fell — a split moves cases, so some of these moved:')
  for (const line of shrank.slice(0, 20)) {
    console.error(`  ${line}`)
  }
  console.error(
    '\nAdapt the cases to the retained behaviour, or list a file in config/deleted-test-cases.txt' +
      '\nwith a comment naming what it covered and why that behaviour is gone.'
  )
  process.exit(1)
}

console.log(
  `Test case deletion check OK — ${sum(after)} cases across ${after.size} file(s), none lost.`
)
