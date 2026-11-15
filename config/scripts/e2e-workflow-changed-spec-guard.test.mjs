import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
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
  it('refuses a shard with no specs instead of running the full suite', () => {
    const script = changedSpecRunScript(
      readFileSync(join(projectDir, '.github/workflows/e2e.yml'), 'utf8')
    )
    const run = spawnSync('bash', ['-e', '-c', script], {
      env: { PATH: process.env.PATH, TEST_FILES_JSON: '[]', PROJECT: '' },
      encoding: 'utf8',
      input: '',
      timeout: 10_000
    })
    expect(run.stdout).toContain('refusing to run the full suite')
    expect(run.status).toBe(1)
  })
})
