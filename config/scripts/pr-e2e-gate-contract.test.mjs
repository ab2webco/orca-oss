import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const prWorkflow = parse(readFileSync(join(projectDir, '.github/workflows/pr.yml'), 'utf8'))
const e2eWorkflow = parse(readFileSync(join(projectDir, '.github/workflows/e2e.yml'), 'utf8'))

const filterStep = prWorkflow.jobs['e2e-paths'].steps.find(
  (step) => step.name === 'Select E2E scope'
)
const verifyStep = prWorkflow.jobs.verify.steps.find(
  (step) => step.name === 'Require successful checks'
)

describe('PR E2E gate contract', () => {
  it('keeps E2E advisory while the suite is red on main', () => {
    // Why: pin the deliberate choice so it reads as intentional rather than as
    // the "forgot to wire the gate" bug this file originally caught. Gating on a
    // suite that fails every scheduled run would block the PRs that fix it.
    // Flipping to blocking means updating this expectation too — see the comment
    // on verify's Require-successful-checks step for the exact wiring.
    expect(prWorkflow.jobs.verify.needs).not.toContain('e2e')
    expect(verifyStep.env.E2E).toBeUndefined()
    expect(verifyStep.run).not.toContain('$E2E')
  })

  it('passes the selected scope to the reusable E2E workflow', () => {
    // Why: without this the job could lose its filter and run on every PR — the
    // cost the path filter exists to avoid — while the gate assertions above
    // stay green.
    expect(prWorkflow.jobs.e2e.needs).toBe('e2e-paths')
    expect(prWorkflow.jobs.e2e.if).toBe("needs.e2e-paths.outputs.should_run == 'true'")
    expect(prWorkflow.jobs['e2e-paths'].outputs.should_run).toBe(
      '${{ steps.filter.outputs.should_run }}'
    )
    expect(prWorkflow.jobs['e2e-paths'].outputs.test_files).toBe(
      '${{ steps.filter.outputs.test_files }}'
    )
    expect(prWorkflow.jobs.e2e.with.test_files).toBe('${{ needs.e2e-paths.outputs.test_files }}')
  })

  it('names the run after the scope it selected', () => {
    // Why: #67 merged past a check that read `e2e: skipped`, which looks the
    // same as a pass. The mode has to be on the check name or the reader has to
    // open the log to learn whether anything ran.
    expect(prWorkflow.jobs['e2e-paths'].outputs.mode).toBe('${{ steps.filter.outputs.mode }}')
    expect(prWorkflow.jobs.e2e.name).toBe('e2e (${{ needs.e2e-paths.outputs.mode }})')
  })

  it('cancels a superseded PR E2E without reaching the shared callers', () => {
    // Why on the caller job and not in e2e.yml: a workflow-level block there
    // would put the scheduled run and release-cut's dispatch in one group, and
    // neither is superseded by a push. Keyed to the PR number, this can only
    // cancel a run for a commit that is no longer that PR's head.
    expect(prWorkflow.jobs.e2e.concurrency).toEqual({
      group: 'pr-e2e-${{ github.event.pull_request.number }}',
      'cancel-in-progress': true
    })
    expect(e2eWorkflow.concurrency).toBeUndefined()
  })

  it('enforces every job verify depends on', () => {
    // Why: derive from verify.needs rather than hardcoding, so adding a required
    // job without adding it to the strict loop fails here instead of silently
    // leaving that job unenforced. This is what caught GIT_COMPATIBILITY and
    // SHELL_CONTRACTS being absent from an earlier hardcoded list.
    const strictLoop = verifyStep.run.slice(0, verifyStep.run.indexOf('done'))
    for (const job of prWorkflow.jobs.verify.needs) {
      // A job name may contain a dash (verify-windows); env vars may not.
      const envVar = job.toUpperCase().replaceAll('-', '_')
      expect(verifyStep.env[envVar]).toBe(`\${{ needs.${job}.result }}`)
      expect(strictLoop).toContain(`"$${envVar}"`)
    }
  })

  it('selects modified files without running deleted tests', () => {
    // The path and spec patterns themselves live in the scope script, which is
    // unit-tested against the real file lists of #57, #60 and #67.
    expect(filterStep.run).toContain('--diff-filter=AMCR')
    expect(filterStep.run).toContain('node config/scripts/select-pr-e2e-scope.mjs')
  })

  it('uses one runner for changed specs and keeps full runs sharded', () => {
    expect(e2eWorkflow.jobs.e2e.if).toBe("inputs.test_files == ''")
    expect(e2eWorkflow.jobs['changed-e2e'].if).toBe("inputs.test_files != ''")
    expect(e2eWorkflow.jobs['changed-e2e'].strategy).toBeUndefined()
    expect(e2eWorkflow.jobs['ssh-docker-watcher-isolation'].if).toBe("inputs.test_files == ''")
    const changedRun = e2eWorkflow.jobs['changed-e2e'].steps.find(
      (step) => step.name === 'Run changed E2E specs'
    )
    expect(changedRun.env.TEST_FILES_JSON).toBe('${{ inputs.test_files }}')
    expect(changedRun.run).toContain('pnpm run test:e2e "${TEST_FILES[@]}" --workers=1')
  })

  it('keeps dedicated E2E workflows out of pull request CI', () => {
    const dedicatedWorkflows = [
      'golden-e2e-experiment.yml',
      'linux-wayland-gpu-sandbox.yml',
      'terminal-ime-e2e.yml',
      'win-crash-survival-e2e.yml',
      'windows-terminal-restart-e2e.yml'
    ]

    for (const file of dedicatedWorkflows) {
      const workflow = parse(readFileSync(join(projectDir, '.github/workflows', file), 'utf8'))
      expect(workflow.on.pull_request, file).toBeUndefined()
    }
  })

  it('scopes detection to the PR range so base drift cannot false-trigger', () => {
    expect(filterStep.run).toContain('--merge-base "$BASE_SHA" "$HEAD_SHA"')
    expect(filterStep.run).toContain('set -euo pipefail')
    // Why env and not inline expressions: the SHAs reach git as values, so a
    // crafted ref cannot close the quote and run in this shell.
    expect(filterStep.env.BASE_SHA).toBe('${{ github.event.pull_request.base.sha }}')
    expect(filterStep.env.HEAD_SHA).toBe('${{ github.event.pull_request.head.sha }}')
  })
})
