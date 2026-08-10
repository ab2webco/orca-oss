#!/usr/bin/env node
// Decides what the PR E2E lane runs from a changed-path list on stdin, and
// writes should_run/mode/test_files to $GITHUB_OUTPUT.
//
// Why paths at all: main-process runtime, PTY and IPC changes never touch
// tests/e2e/**, so a spec-only filter skipped exactly the class that shipped a
// broken suite twice — #57 merged green and #67 merged with `e2e: skipped`
// while three orchestration specs were red on its head. A path match has no
// changed spec to narrow to, so it runs the full sharded suite.
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// The cheap lane this gate keeps: a PR that edits a spec still runs that spec.
export const CHANGED_SPEC = /^tests\/e2e\/.*\.spec\.ts$/

// Why these and not every path under src: both measured escapes landed under
// src/main/runtime/** (which already contains the runtime RPC method surface),
// and the three specs #67 broke import src/main/daemon, src/main/sqlite,
// src/main/runtime/orchestration/db, src/cli/runtime-client and
// src/shared/runtime-types directly. src/main/ipc/** is taken whole rather than
// curated to its pty/terminal/runtime files: across the last 30 fork PRs the
// whole directory costs exactly 1 extra full run, because an ipc change almost
// always lands together with a runtime change — not worth a hand-maintained
// list that rots silently.
//
// Deliberately absent: src/renderer/** (would trigger on nearly every PR; no
// measured escape was renderer-only) and pnpm-lock.yaml. Both are named gaps —
// a renderer-only or dependency-only E2E break is still not caught before merge.
export const FULL_SUITE_PATHS = [
  /^src\/main\/runtime\//,
  /^src\/main\/ipc\//,
  /^src\/main\/pty\//,
  /^src\/main\/daemon\//,
  /^src\/main\/sqlite\//,
  /^src\/cli\/runtime(\/|-|\.)/,
  /^src\/shared\/runtime-types\.ts$/,
  // Shared harness. #60 changed one fixture under tests/e2e and the spec-only
  // filter skipped the suite that fixture feeds. Code files only, so editing
  // tests/e2e/AGENTS.md still skips.
  /^tests\/e2e\/(?!.*\.spec\.ts$).*\.(ts|tsx|mjs)$/,
  /^tests\/playwright\.config\.ts$/,
  // The lane itself, so a change to this gate is proved by running it.
  /^\.github\/workflows\/(pr|e2e)\.yml$/,
  /^config\/scripts\/select-pr-e2e-scope\.mjs$/
]

/**
 * @param {string[]} changedPaths
 */
export function selectPrE2eScope(changedPaths) {
  const paths = changedPaths.map((line) => line.trim()).filter((line) => line.length > 0)
  const fullSuiteMatches = paths.filter((path) =>
    FULL_SUITE_PATHS.some((pattern) => pattern.test(path))
  )
  const changedSpecs = paths.filter((path) => CHANGED_SPEC.test(path))

  if (fullSuiteMatches.length > 0) {
    // Why the empty string and not '[]': e2e.yml keys its sharded suite on
    // `inputs.test_files == ''`. A '[]' here would instead select changed-e2e,
    // whose unquoted expansion would run the whole suite on one runner and die
    // at its 30-minute timeout.
    return { mode: 'full', shouldRun: true, testFiles: '', triggeredBy: fullSuiteMatches }
  }

  if (changedSpecs.length > 0) {
    return {
      mode: 'changed-specs',
      shouldRun: true,
      testFiles: JSON.stringify(changedSpecs),
      triggeredBy: changedSpecs
    }
  }

  return { mode: 'none', shouldRun: false, testFiles: '', triggeredBy: [] }
}

export function main(changedPaths, { output = process.env.GITHUB_OUTPUT, log = console.log } = {}) {
  const scope = selectPrE2eScope(changedPaths)

  if (output) {
    appendFileSync(
      output,
      `should_run=${scope.shouldRun}\nmode=${scope.mode}\ntest_files=${scope.testFiles}\n`
    )
  }

  log(`E2E scope: ${scope.mode} (should_run=${scope.shouldRun})`)
  if (scope.triggeredBy.length > 0) {
    log('Triggered by:')
    for (const path of scope.triggeredBy) {
      log(`  ${path}`)
    }
  }

  return scope
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main((await readStdin()).split('\n'))
}
