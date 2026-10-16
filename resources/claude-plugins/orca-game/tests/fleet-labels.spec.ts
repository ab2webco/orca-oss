import { describe, expect, it } from 'vitest'

import { needsLineOf, reviewTextOf, teammatesOf, workItemTextOf } from '../hooks/fleet-labels'

describe('fleet labels', () => {
  it('names a review by its provider sign, state and CI', () => {
    const review = { provider: 'github', number: 4, title: '', url: 'u', state: 'open' } as const
    expect(reviewTextOf({ ...review, ci: 'failure' })).toBe('#4 open · CI failing')
    expect(reviewTextOf({ ...review, ci: 'success', provider: 'gitlab' })).toBe(
      '!4 open · CI green'
    )
    expect(reviewTextOf({ ...review, ci: 'pending', state: 'draft' })).toBe('#4 draft · CI running')
  })

  it('names a work item by its status, or its group when the status is empty', () => {
    const item = { provider: 'linear', identifier: 'ENG-1', title: 't', url: '' } as const
    expect(workItemTextOf({ ...item, status: 'In Review', statusGroup: 'review' })).toBe(
      'ENG-1 In Review'
    )
    expect(workItemTextOf({ ...item, status: '', statusGroup: 'todo' })).toBe('ENG-1 todo')
  })

  it('counts teammates and joins what needs the person', () => {
    expect(teammatesOf(1)).toBe('Team 1 teammate')
    expect(teammatesOf(3)).toBe('Team 3 teammates')
    expect(
      needsLineOf([
        { name: 'x', text: 'waiting on you', url: null },
        { name: '#4', text: 'CI failing', url: 'u' }
      ])
    ).toBe('Needs you: x waiting on you · #4 CI failing')
  })
})
