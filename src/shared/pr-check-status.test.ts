import { describe, expect, it } from 'vitest'
import { derivePRCheckStatus, derivePRCheckStatusFromRollup } from './pr-check-status'
import type { PRCheckDetail } from './github/check-types'

const check = (
  status: PRCheckDetail['status'],
  conclusion: PRCheckDetail['conclusion']
): PRCheckDetail => ({ name: 'ci', status, conclusion, url: null })

describe('provider-neutral check status', () => {
  it('keeps explicit nonterminal and missing-conclusion checks pending', () => {
    expect(derivePRCheckStatus([check('queued', null)])).toBe('pending')
    expect(derivePRCheckStatus([check('in_progress', null)])).toBe('pending')
    expect(derivePRCheckStatus([check('completed', 'pending')])).toBe('pending')
  })

  it('keeps completed unknown conclusions neutral while preserving attention states', () => {
    expect(derivePRCheckStatus([check('completed', null)])).toBe('neutral')
    expect(
      derivePRCheckStatus([check('completed', 'future_state' as PRCheckDetail['conclusion'])])
    ).toBe('neutral')
    expect(derivePRCheckStatus([check('completed', 'action_required')])).toBe('failure')
  })

  it('normalizes GitHub-style rollups without turning malformed data into success', () => {
    expect(derivePRCheckStatusFromRollup([{ status: 'IN_PROGRESS', conclusion: null }])).toBe(
      'pending'
    )
    expect(
      derivePRCheckStatusFromRollup([{ status: 'COMPLETED', conclusion: 'future_state' }])
    ).toBe('neutral')
    expect(derivePRCheckStatusFromRollup([{}])).toBe('neutral')
    expect(derivePRCheckStatusFromRollup([{ state: 'PENDING' }])).toBe('pending')
    expect(derivePRCheckStatusFromRollup([{ state: 'ERROR' }])).toBe('failure')
  })

  it.each(['ERROR', 'STARTUP_FAILURE'])('treats raw %s conclusions as failures', (conclusion) => {
    expect(derivePRCheckStatusFromRollup([{ status: 'COMPLETED', conclusion }])).toBe('failure')
  })
})

describe('superseded cancelled runs in a GitHub rollup (ORCA-1269)', () => {
  const run = (runId: number, workflowName: string, name: string, conclusion: string) => ({
    __typename: 'CheckRun',
    workflowName,
    name,
    status: 'COMPLETED',
    conclusion,
    detailsUrl: `https://github.com/o/r/actions/runs/${runId}/job/${runId}${name.length}`
  })

  it('does not count a cancelled run superseded by a newer run of its workflow as red', () => {
    const rollup = [
      run(200, 'PR Checks', 'verify', 'FAILURE'),
      run(200, 'PR Checks', 'lint', 'CANCELLED'),
      run(201, 'PR Checks', 'lint', 'SUCCESS')
    ]
    expect(derivePRCheckStatusFromRollup(rollup)).toBe('success')
  })

  it('does not count a failed aggregate job of a superseded cancelled run as red', () => {
    const rollup = [
      run(300, 'PR Checks', 'verify', 'FAILURE'),
      run(300, 'PR Checks', 'build', 'CANCELLED'),
      { ...run(301, 'PR Checks', 'build', ''), status: 'IN_PROGRESS', conclusion: null }
    ]
    expect(derivePRCheckStatusFromRollup(rollup)).toBe('pending')
  })

  it('still reads red when the latest run of a workflow is itself cancelled', () => {
    const rollup = [
      run(400, 'PR Checks', 'lint', 'SUCCESS'),
      run(401, 'PR Checks', 'lint', 'CANCELLED')
    ]
    expect(derivePRCheckStatusFromRollup(rollup)).toBe('failure')
  })

  it('still reads red for a failed run with no newer run of its workflow', () => {
    const rollup = [
      run(500, 'PR Checks', 'verify', 'FAILURE'),
      run(500, 'PR Checks', 'build', 'CANCELLED')
    ]
    expect(derivePRCheckStatusFromRollup(rollup)).toBe('failure')
  })

  it('keeps a cancelled run of another workflow red', () => {
    const rollup = [
      run(600, 'CodeQL', 'analyze', 'CANCELLED'),
      run(601, 'PR Checks', 'lint', 'SUCCESS')
    ]
    expect(derivePRCheckStatusFromRollup(rollup)).toBe('failure')
  })
})
