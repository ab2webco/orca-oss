import { describe, expect, it } from 'vitest'
import { classifyProjectUrgency, strongerUrgencySignal } from './project-urgency-tier'
import type { WorkspaceUrgencySignal } from './project-urgency-tier'

const signals = (entries: [string, WorkspaceUrgencySignal][]) => new Map(entries)
const noCI = () => false

describe('classifyProjectUrgency', () => {
  it('puts a project with a question in Needs you, counting its questions', () => {
    expect(classifyProjectUrgency(['a', 'b'], signals([['a', 'question']]), noCI)).toEqual({
      tier: 1,
      reason: { kind: 'questions', count: 1 }
    })
    expect(
      classifyProjectUrgency(
        ['a', 'b', 'c'],
        signals([
          ['a', 'question'],
          ['c', 'question']
        ]),
        noCI
      ).reason
    ).toEqual({ kind: 'questions', count: 2 })
  })

  it('puts an account limit in Needs you and names it over a question', () => {
    expect(classifyProjectUrgency(['a'], signals([['a', 'account-limit']]), noCI)).toEqual({
      tier: 1,
      reason: { kind: 'account-limit' }
    })
    expect(
      classifyProjectUrgency(
        ['a', 'b'],
        signals([
          ['a', 'question'],
          ['b', 'account-limit']
        ]),
        noCI
      ).reason
    ).toEqual({ kind: 'account-limit' })
  })

  it('puts a project with a failing PR in At risk', () => {
    expect(classifyProjectUrgency(['a', 'b'], signals([]), (id) => id === 'b')).toEqual({
      tier: 2,
      reason: { kind: 'ci-failing' }
    })
  })

  it('puts a project with a running agent in Working, counting them', () => {
    expect(
      classifyProjectUrgency(
        ['a', 'b', 'c'],
        signals([
          ['a', 'working'],
          ['b', 'working']
        ]),
        noCI
      )
    ).toEqual({ tier: 3, reason: { kind: 'working', count: 2 } })
  })

  it('leaves a project with nothing running at Rest, with no reason', () => {
    expect(classifyProjectUrgency(['a'], signals([]), noCI)).toEqual({ tier: 4, reason: null })
    expect(classifyProjectUrgency([], signals([]), noCI)).toEqual({ tier: 4, reason: null })
  })

  it('takes its most urgent workspace: Needs you over At risk over Working', () => {
    const all = signals([
      ['q', 'question'],
      ['w', 'working']
    ])
    expect(classifyProjectUrgency(['q', 'w', 'ci'], all, (id) => id === 'ci').tier).toBe(1)
    // §7: orca-oss has agents working and a delivered PR failing CI, and reads "CI falla".
    expect(
      classifyProjectUrgency(['w', 'ci'], signals([['w', 'working']]), (id) => id === 'ci')
    ).toEqual({ tier: 2, reason: { kind: 'ci-failing' } })
  })

  it('ignores signals of workspaces outside the project', () => {
    expect(classifyProjectUrgency(['a'], signals([['z', 'question']]), noCI).tier).toBe(4)
  })
})

describe('strongerUrgencySignal', () => {
  it('keeps the signal only the person can unblock, the account limit first', () => {
    expect(strongerUrgencySignal('working', 'question')).toBe('question')
    expect(strongerUrgencySignal('question', 'account-limit')).toBe('account-limit')
    expect(strongerUrgencySignal('account-limit', 'working')).toBe('account-limit')
    expect(strongerUrgencySignal(undefined, 'working')).toBe('working')
  })
})
