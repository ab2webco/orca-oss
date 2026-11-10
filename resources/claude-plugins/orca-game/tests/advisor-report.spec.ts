import { describe, expect, it } from 'vitest'

import { advisorReportOf } from '../hooks/advisor-report'
import type { Advisor } from '../hooks/allies'
import type { AdvisorLogEntry } from '../types'

const ADVISOR: Advisor = {
  model: 'Opus 5.5',
  effort: 'high',
  line: 'jev',
  subagents: [],
  ci: [],
  notices: []
}
const PINS = { model: true, effort: false }
const entry = (key: string, patch: Partial<AdvisorLogEntry> = {}): AdvisorLogEntry => ({
  key,
  id: `call-${key}`,
  title: 'rm -rf build',
  model: 'Opus 5.5',
  effort: 'high',
  verdict: 'allow',
  gesture: null,
  at: 10,
  ...patch
})

describe("the pane's Jev report", () => {
  it('reads exactly as before while Jev has decided nothing', () => {
    const before = { version: 1, model: 'Opus 5.5', effort: 'high', line: 'jev', pinned: PINS }
    expect(JSON.parse(advisorReportOf(ADVISOR, PINS))).toEqual(before)
    expect(JSON.parse(advisorReportOf(ADVISOR, PINS, []))).toEqual(before)
    expect(advisorReportOf(null, PINS, [entry('a')])).toBe('null')
  })

  it("adds Jev's latest decisions as ids, verdicts and gestures, never their titles", () => {
    const log = [entry('a'), entry('b', { verdict: 'deny', gesture: 'escalated' })]
    const report = JSON.parse(advisorReportOf(ADVISOR, PINS, log))
    expect(report.decisions).toEqual([
      { id: 'a', verdict: 'allow', gesture: null },
      { id: 'b', verdict: 'deny', gesture: 'escalated' }
    ])
    expect(JSON.stringify(report)).not.toContain('rm -rf')
  })
})
