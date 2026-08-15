import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

/**
 * Why a workflow-ordering test: both changed-line gates widen a sync PR's base to
 * the upstream tip, and both need `refs/remotes/upstream/main` to tell a sync from
 * a normal PR. Without it they fall back to the PR base and pass — the widening is
 * simply absent, and no output says so. Moving the fetch below either gate is
 * therefore a silent revert of ORCA-202/ORCA-205, green in CI and green in every
 * unit suite, which is exactly how #81 read as landed for a full sync cycle.
 */
const steps = parse(readFileSync('.github/workflows/pr.yml', 'utf8')).jobs.static_analysis.steps
const indexOfStepRunning = (script) =>
  steps.findIndex((step) => step.run?.includes(`pnpm run ${script}`))

describe('PR workflow upstream fetch ordering', () => {
  it('fetches upstream history before the gates that resolve a base from it', () => {
    const fetchIndex = steps.findIndex(
      (step) => step.name === 'Fetch upstream history for base resolution'
    )
    const codeQualityIndex = indexOfStepRunning('check:code-quality:changed')
    const reactDoctorIndex = indexOfStepRunning('check:react-doctor:changed')

    expect(fetchIndex).toBeGreaterThanOrEqual(0)
    expect(codeQualityIndex).toBeGreaterThanOrEqual(0)
    expect(reactDoctorIndex).toBeGreaterThanOrEqual(0)
    expect(fetchIndex).toBeLessThan(codeQualityIndex)
    expect(fetchIndex).toBeLessThan(reactDoctorIndex)
  })

  it('keeps the fetch non-fatal so an unreachable upstream degrades to the PR base', () => {
    const fetchStep = steps.find(
      (step) => step.name === 'Fetch upstream history for base resolution'
    )

    expect(fetchStep['continue-on-error']).toBe(true)
    expect(fetchStep.run).toContain('refs/remotes/upstream/main')
  })
})
