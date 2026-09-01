#!/usr/bin/env node
// A suite gets greener when tests are deleted, so "N passed" cannot tell a fix from a
// removal. This compares the number of cases per test file against a base ref and fails on
// any decrease that is not declared in config/deleted-test-cases.txt.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// An empty argv slot reaches here as '' from `pnpm run … -- "$SHA"` when the SHA is
// missing, and `git diff '' ...HEAD` answers with its usage text rather than an error.
const requestedRef = (process.argv[2] ?? '').trim()
const baseRef = requestedRef === '' ? 'origin/main' : requestedRef
const allowlistPath = fileURLToPath(new URL('../deleted-test-cases.txt', import.meta.url))
const CASE = /^\s*(?:it|test)(?:\.\w+)?\s*\(/gm

const allowed = new Set(
  existsSync(allowlistPath)
    ? readFileSync(allowlistPath, 'utf8')
        .split('\n')
        .map((line) => line.replace(/#.*$/, '').trim())
        .filter(Boolean)
    : []
)

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function countCases(source) {
  return (source.match(CASE) ?? []).length
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

const changed = git(['diff', '--name-only', '--diff-filter=MD', `${baseRef}...HEAD`])
  .split('\n')
  .filter((path) => /\.(test|spec)\.(ts|tsx|mjs)$/.test(path))

const losses = []
for (const path of changed) {
  if (allowed.has(path)) {
    continue
  }
  let before = 0
  try {
    before = countCases(git(['show', `${baseRef}:${path}`]))
  } catch {
    continue // added on this branch; nothing to lose
  }
  const after = existsSync(path) ? countCases(readFileSync(path, 'utf8')) : 0
  if (after < before) {
    losses.push(`${path}: ${before} → ${after}`)
  }
}

if (losses.length > 0) {
  console.error(`Test cases were removed (${losses.length} file(s)):`)
  for (const loss of losses) {
    console.error(`  ${loss}`)
  }
  console.error(
    '\nAdapt the case to the retained behaviour, or list the file in config/deleted-test-cases.txt' +
      '\nwith a comment naming what it covered and why that behaviour is gone.'
  )
  process.exit(1)
}

console.log(
  `Test case deletion check OK — ${changed.length} changed test file(s), none lost cases.`
)
