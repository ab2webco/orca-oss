import { describe, expect, it } from 'vitest'
import { findUnknownOrcaEventNames, matchesOrcaEventFilter, type OrcaEvent } from './orca-events'

const agentDone: OrcaEvent = {
  name: 'agent.status.changed',
  at: 1,
  worktreeId: 'wt-1',
  terminal: 'term_a',
  payload: { paneKey: 'tab:leaf', state: 'done' }
}

describe('matchesOrcaEventFilter', () => {
  it('passes every event when no filter is set', () => {
    expect(matchesOrcaEventFilter(agentDone, { names: [] })).toBe(true)
  })

  it('matches exact names and families', () => {
    expect(matchesOrcaEventFilter(agentDone, { names: ['agent.status.changed'] })).toBe(true)
    expect(matchesOrcaEventFilter(agentDone, { names: ['agent.*'] })).toBe(true)
    expect(matchesOrcaEventFilter(agentDone, { names: ['terminal.*'] })).toBe(false)
    expect(matchesOrcaEventFilter(agentDone, { names: ['agent.status'] })).toBe(false)
  })

  it('narrows by worktree and terminal', () => {
    expect(matchesOrcaEventFilter(agentDone, { names: [], worktreeId: 'wt-1' })).toBe(true)
    expect(matchesOrcaEventFilter(agentDone, { names: [], worktreeId: 'wt-2' })).toBe(false)
    expect(matchesOrcaEventFilter(agentDone, { names: [], terminal: 'term_a' })).toBe(true)
    expect(matchesOrcaEventFilter(agentDone, { names: [], terminal: 'term_b' })).toBe(false)
  })
})

describe('findUnknownOrcaEventNames', () => {
  it('reports names and families no event matches', () => {
    expect(
      findUnknownOrcaEventNames(['terminal.*', 'agent.status.changed', 'agent.done', 'pty.*'])
    ).toEqual(['agent.done', 'pty.*'])
  })
})
