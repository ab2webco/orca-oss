import { describe, expect, it } from 'vitest'

import { needPartsOf, reviewTextOf, teammatesOf, workItemTextOf } from '../hooks/fleet-labels'
import { setGameLocale } from '../hooks/game-strings'

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
    const parts = needPartsOf(
      [
        { name: 'x', text: 'waiting on you', url: null },
        { name: '#4', text: 'CI failing', url: 'https://ci' }
      ],
      80
    )
    expect(parts.map((one) => one.text).join('')).toBe(
      'Needs you: x waiting on you · #4 CI failing'
    )
  })

  // Why: agent names, review numbers and tracker statuses are data and stay as Orca sent them.
  it('speaks the language the session was launched with', () => {
    setGameLocale('es')
    try {
      const review = { provider: 'github', number: 4, title: '', url: 'u', state: 'open' } as const
      expect(teammatesOf(2)).toBe('Equipo: 2 compañeros')
      expect(reviewTextOf({ ...review, ci: 'failure' })).toBe('#4 abierto · CI fallando')
      const item = { provider: 'linear', identifier: 'ENG-1', title: 't', url: '' } as const
      expect(workItemTextOf({ ...item, status: 'In Review', statusGroup: 'review' })).toBe(
        'ENG-1 In Review'
      )
      const parts = needPartsOf([{ name: 'x', text: 'te espera', url: null }], 80)
      expect(parts.map((one) => one.text).join('')).toBe('Te necesitan: x te espera')
    } finally {
      setGameLocale('en')
    }
  })
})
