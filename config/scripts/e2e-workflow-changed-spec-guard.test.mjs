import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')

/** The changed-e2e job's run script, as GitHub hands it to bash. */
function changedSpecRunScript(workflowText) {
  const steps = parse(workflowText).jobs['changed-e2e'].steps
  return steps.find((step) => step.name === 'Run changed E2E specs').run
}

// Why run the real step: with no file argument Playwright runs the whole suite, which is how a
// one-spec change ran 841 tests into the 30-minute cap (ORCA-1199).
describe('changed-e2e run step', () => {
  let stubDir = ''
  afterEach(() => rmSync(stubDir, { recursive: true, force: true }))

  it('refuses a shard with no specs instead of running the full suite', () => {
    const script = changedSpecRunScript(
      readFileSync(join(projectDir, '.github/workflows/e2e.yml'), 'utf8')
    )
    // Why a stub: if the guard falls through, the step must fail here, never start a local E2E.
    stubDir = mkdtempSync(join(tmpdir(), 'changed-e2e-guard-'))
    writeFileSync(join(stubDir, 'xvfb-run'), '#!/bin/sh\necho "the full suite started"\nexit 99\n')
    chmodSync(join(stubDir, 'xvfb-run'), 0o755)
    const run = spawnSync('bash', ['-e', '-c', script], {
      // Why HOME: the runner sets it, and a jq wrapper script in ~/.local/bin needs it (ORCA-1407).
      env: {
        PATH: `${stubDir}:${process.env.PATH}`,
        HOME: process.env.HOME,
        TEST_FILES_JSON: '[]',
        PROJECT: ''
      },
      encoding: 'utf8',
      input: '',
      timeout: 10_000
    })
    expect(run.stdout).toContain('refusing to run the full suite')
    expect(run.status).toBe(1)
  })
})
