import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

// Wiring only. The classifier's behaviour is proven against recorded API
// payloads in ci-failure-class.test.mjs; this file just guards the four workflow
// settings the reporter cannot work without.
const workflow = parse(readFileSync('.github/workflows/pr.yml', 'utf8'))
const reporter = workflow.jobs.ci_failure_class

describe('the CI failure-class reporter job', () => {
  it('runs even when the jobs it reports on failed or were cancelled', () => {
    expect(reporter.if).toBe('always()')
  })

  it('waits for the E2E lane, whose timeouts are the case that opened ORCA-215', () => {
    expect(reporter.needs).toContain('e2e')
    expect(reporter.needs).toContain('verify')
  })

  it('asks for the actions:read scope the jobs API needs', () => {
    expect(reporter.permissions).toEqual({ contents: 'read', actions: 'read' })
    // The workflow default stays read-only; the scope is granted per job.
    expect(workflow.permissions).toEqual({ contents: 'read' })
  })

  it('is not part of the merge gate', () => {
    expect(workflow.jobs.verify.needs).not.toContain('ci_failure_class')
  })
})
