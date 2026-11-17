#!/usr/bin/env node
// Decides what the PR E2E lane runs from a changed-path list on stdin, and
// writes should_run/mode/test_files to $GITHUB_OUTPUT.
//
// Why paths at all: main-process runtime, PTY and IPC changes never touch
// tests/e2e/**, so a spec-only filter skipped exactly the class that shipped a
// broken suite twice — #57 merged green and #67 merged with `e2e: skipped`
// while three orchestration specs were red on its head. A path match has no
// changed spec to narrow to, so it runs the full sharded suite.
import { appendFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
// Deliberately absent: src/renderer/** (the full suite would trigger on nearly
// every PR) and pnpm-lock.yaml. A dependency-only E2E break is still not caught
// before merge; a renderer one is caught only in an area RENDERER_AREA_SPECS maps.
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
  // The Docker SSH image's Dockerfile and install script, which the code-only rule misses.
  /^tests\/e2e\/fixtures\/docker-ssh-relay\//,
  /^tests\/playwright\.config\.ts$/,
  // The lane itself, so a change to this gate is proved by running it.
  /^\.github\/workflows\/(pr|e2e)\.yml$/,
  /^\.github\/actions\/install-apt-packages\//,
  /^config\/scripts\/ci-apt\.sh$/,
  /^config\/scripts\/(select-pr-e2e-scope|apt-archive-cache)\.mjs$/
]

// A renderer area runs the specs that cover it, not none and not the full suite.
// Only areas with a measured queue escape: #1186 (ORCA-1185) fixed the ride timer
// behind a red team-panel-building.spec.ts with a team-scene-only diff, and the
// queue ran `none` on it. An unmapped area stays `none`. PR pushes defer these
// specs to the merge queue, like the full suite.
export const RENDERER_AREA_SPECS = [
  {
    area: /^src\/renderer\/src\/components\/(team-scene|team-panel)\//,
    specs: /^tests\/e2e\/team-panel-[^/]*\.spec\.ts$/
  }
]

function listE2eSpecs() {
  const dir = fileURLToPath(new URL('../../tests/e2e/', import.meta.url))
  return readdirSync(dir)
    .filter((name) => name.endsWith('.spec.ts'))
    .map((name) => `tests/e2e/${name}`)
    .sort()
}

/**
 * @param {string[]} changedPaths
 * @param {{ deferFullSuite?: boolean, specFiles?: string[] }} [options] PR pushes defer the full
 *   suite and area specs to the merge queue (ORCA-932); specFiles defaults to tests/e2e on disk.
 */
export function selectPrE2eScope(changedPaths, { deferFullSuite = false, specFiles } = {}) {
  const paths = changedPaths.map((line) => line.trim()).filter((line) => line.length > 0)
  const fullSuiteMatches = paths.filter((path) =>
    FULL_SUITE_PATHS.some((pattern) => pattern.test(path))
  )
  const changedSpecs = paths.filter((path) => CHANGED_SPEC.test(path))
  const areaMatches = paths.filter((path) =>
    RENDERER_AREA_SPECS.some(({ area }) => area.test(path))
  )

  if (
    (fullSuiteMatches.length > 0 || areaMatches.length > 0) &&
    deferFullSuite &&
    changedSpecs.length === 0
  ) {
    return {
      mode: 'merge-queue',
      shouldRun: false,
      testFiles: '',
      triggeredBy: [...fullSuiteMatches, ...areaMatches]
    }
  }

  if (fullSuiteMatches.length > 0 && !deferFullSuite) {
    // Why the empty string and not '[]': e2e.yml keys its sharded suite on
    // `inputs.test_files == ''`. A '[]' here would instead select changed-e2e,
    // whose unquoted expansion would run the whole suite on one runner and die
    // at its 30-minute timeout.
    return {
      mode: 'full',
      shouldRun: true,
      testFiles: '',
      triggeredBy: fullSuiteMatches
    }
  }

  const areaSpecs = []
  if (areaMatches.length > 0 && !deferFullSuite) {
    const available = specFiles ?? listE2eSpecs()
    for (const { area, specs } of RENDERER_AREA_SPECS) {
      if (areaMatches.some((path) => area.test(path))) {
        areaSpecs.push(...available.filter((spec) => specs.test(spec)))
      }
    }
  }
  const selectedSpecs = [...new Set([...changedSpecs, ...areaSpecs])]

  if (selectedSpecs.length > 0) {
    return {
      mode: 'changed-specs',
      shouldRun: true,
      testFiles: JSON.stringify(selectedSpecs),
      triggeredBy: [...changedSpecs, ...(areaSpecs.length > 0 ? areaMatches : [])]
    }
  }

  return { mode: 'none', shouldRun: false, testFiles: '', triggeredBy: [] }
}

export function main(
  changedPaths,
  { output = process.env.GITHUB_OUTPUT, log = console.log, argv = process.argv.slice(2) } = {}
) {
  const scope = selectPrE2eScope(changedPaths, {
    deferFullSuite: argv.includes('--defer-full-suite')
  })

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
