import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { main, selectPrE2eScope } from './select-pr-e2e-scope.mjs'

// The real file list of 2993035166 — `fix(orchestration): confirm the agent is
// ready before injecting a dispatch (ORCA-191) (#67)`, the PR that merged with
// `e2e: skipped` while three orchestration specs were red on its head. Pinned
// as a literal because the test job checks out at depth 1, so `git show` cannot
// resolve it on CI.
const PR_67_FILES = [
  'src/cli/help.ts',
  'src/cli/specs/core.ts',
  'src/cli/terminal-format.ts',
  'src/main/runtime/agent-composer-readiness.test.ts',
  'src/main/runtime/agent-composer-readiness.ts',
  'src/main/runtime/orca-runtime.test.ts',
  'src/main/runtime/orca-runtime.ts',
  'src/main/runtime/orchestration/coordinator-dispatch-lifecycle.test.ts',
  'src/main/runtime/orchestration/coordinator.ts',
  'src/main/runtime/orchestration/db.ts',
  'src/main/runtime/orchestration/dispatch-deadline-monitor.ts',
  'src/main/runtime/orchestration/dispatch-lifecycle-deadline.test.ts',
  'src/main/runtime/orchestration/dispatch-lifecycle-deadline.ts',
  'src/main/runtime/orchestration/dispatch-turn-acceptance.ts',
  'src/main/runtime/orchestration/orchestration-db-retention-pagination.test.ts',
  'src/main/runtime/orchestration/types.ts',
  'src/main/runtime/rpc/methods/orchestration-dispatch-composer-readiness.test.ts',
  'src/main/runtime/rpc/methods/orchestration-workers-new-worktree.test.ts',
  'src/main/runtime/rpc/methods/orchestration-workers.ts',
  'src/main/runtime/rpc/methods/orchestration.ts',
  'src/main/runtime/rpc/methods/terminal.ts',
  'src/shared/agent-turn-acceptance-scanner.test.ts',
  'src/shared/agent-turn-acceptance-scanner.ts',
  'src/shared/composer-ready-observation.test.ts',
  'src/shared/composer-ready-observation.ts',
  'src/shared/draft-paste-ready-scanner.ts',
  'src/shared/runtime-types.ts'
]

const tempDirs = []

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true })
  }
})

function runWithOutputFile(changedPaths) {
  const dir = mkdtempSync(join(tmpdir(), 'orca-e2e-scope-'))
  tempDirs.push(dir)
  const output = join(dir, 'github-output')
  const scope = main(changedPaths, { output, log: () => {} })
  return { scope, output: readFileSync(output, 'utf8') }
}

describe('PR E2E scope selection', () => {
  it('would have run E2E on the head that merged with e2e: skipped', () => {
    // The acceptance criterion for ORCA-196: replaying #67 through this gate.
    const scope = selectPrE2eScope(PR_67_FILES)
    expect(scope.mode).toBe('full')
    expect(scope.shouldRun).toBe(true)
    expect(scope.triggeredBy).toContain('src/main/runtime/orchestration/coordinator.ts')
  })

  it('runs the full suite for an orchestration change with no spec', () => {
    const scope = selectPrE2eScope(['src/main/runtime/orchestration/coordinator.ts'])
    expect(scope.mode).toBe('full')
    expect(scope.shouldRun).toBe(true)
  })

  it('passes an empty test_files so the full run stays sharded', () => {
    // Why exactly '': e2e.yml selects its 10-shard matrix on
    // `inputs.test_files == ''`. A '[]' would select changed-e2e instead, whose
    // empty expansion runs the whole suite on one runner until it times out.
    const { scope, output } = runWithOutputFile(['src/main/runtime/orca-runtime.ts'])
    expect(scope.testFiles).toBe('')
    expect(output).toContain('should_run=true\n')
    expect(output).toContain('mode=full\n')
    expect(output).toContain('test_files=\n')
  })

  it('skips a documentation-only change', () => {
    const { scope, output } = runWithOutputFile([
      'docs/reference/working-process.md',
      'README.md',
      'AGENTS.md'
    ])
    expect(scope.mode).toBe('none')
    expect(scope.shouldRun).toBe(false)
    expect(output).toContain('should_run=false\n')
  })

  it('skips E2E documentation so the trigger stays about behaviour', () => {
    // tests/e2e/** is a trigger for code files only; the directory also holds
    // AGENTS.md, and prose cannot break a spec.
    expect(selectPrE2eScope(['tests/e2e/AGENTS.md']).mode).toBe('none')
  })

  it('keeps a changed spec on the cheap single-runner lane', () => {
    const scope = selectPrE2eScope([
      'tests/e2e/orchestration-worker-terminal-visibility.spec.ts',
      'docs/reference/working-process.md'
    ])
    expect(scope.mode).toBe('changed-specs')
    expect(scope.testFiles).toBe('["tests/e2e/orchestration-worker-terminal-visibility.spec.ts"]')
  })

  it('runs the full suite when a shared E2E fixture changes', () => {
    // #60 changed only this file and the spec-only filter skipped the suite it
    // feeds; a helper has no single spec to narrow to.
    expect(selectPrE2eScope(['tests/e2e/orchestration-worker-restart-fixture.ts']).mode).toBe(
      'full'
    )
    expect(selectPrE2eScope(['tests/e2e/helpers/orca-app.ts']).mode).toBe('full')
    expect(selectPrE2eScope(['tests/playwright.config.ts']).mode).toBe('full')
  })

  it('widens to the full suite when a spec lands with a runtime change', () => {
    const scope = selectPrE2eScope([
      'src/main/runtime/orchestration/coordinator.ts',
      'tests/e2e/orchestration-worker-terminal-visibility.spec.ts'
    ])
    expect(scope.mode).toBe('full')
    expect(scope.testFiles).toBe('')
  })

  it('leaves renderer-only changes to the scheduled and release runs', () => {
    // A deliberate, named gap: zero of the two measured escapes were
    // renderer-only, and adding src/renderer/** would trigger the full suite on
    // very nearly every PR. Changing this line is a cost decision, not a typo
    // fix — see the PR body for ORCA-196.
    const scope = selectPrE2eScope([
      'src/renderer/src/components/TerminalPane.tsx',
      'src/renderer/src/assets/main.css'
    ])
    expect(scope.mode).toBe('none')
    expect(scope.shouldRun).toBe(false)
  })

  it('runs the full suite when the lane itself changes', () => {
    expect(selectPrE2eScope(['.github/workflows/pr.yml']).mode).toBe('full')
    expect(selectPrE2eScope(['.github/workflows/e2e.yml']).mode).toBe('full')
    expect(selectPrE2eScope(['config/scripts/select-pr-e2e-scope.mjs']).mode).toBe('full')
  })

  it('ignores blank lines from an empty diff', () => {
    expect(selectPrE2eScope(['', '  ', '']).mode).toBe('none')
  })

  it('does not treat unit specs outside tests/e2e as E2E specs', () => {
    expect(selectPrE2eScope(['src/shared/composer-ready-observation.test.ts']).mode).toBe('none')
    expect(selectPrE2eScope(['tests/playwright.spec.ts']).mode).toBe('none')
  })
})
