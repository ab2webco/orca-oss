import { describe, expect, it } from 'vitest'

import { cellWidthOf } from '../hooks/cell-width'
import {
  branchLabelOf,
  fitWords,
  memberHeadingOf,
  memberHeadOf,
  memberMetaOf,
  needPartsOf,
  reviewTextOf,
  teammatesOf,
  workItemTextOf
} from '../hooks/fleet-labels'
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

describe('member card labels', () => {
  const ORCA_CUT = 'ORCA-601 El lead del juego delega en subagentes internos de...'

  it('splits the ticket off the name and prefers the work item’s full title', () => {
    expect(memberHeadingOf({ displayName: 'builder' })).toEqual({ name: 'builder', title: '' })
    expect(memberHeadingOf({ displayName: 'ORCA-601 Fix the card' })).toEqual({
      name: 'ORCA-601',
      title: 'Fix the card'
    })
    const workItem = {
      provider: 'plane',
      identifier: 'ORCA-601',
      title: 'El lead del juego delega en subagentes internos de Claude Code',
      url: '',
      status: '',
      statusGroup: 'unknown'
    } as const
    expect(memberHeadingOf({ displayName: ORCA_CUT, workItem })).toEqual({
      name: 'ORCA-601',
      title: workItem.title
    })
  })

  // Why: Orca cuts a long name at a fixed length, so its last word may be half a word.
  it('drops the last word of a name Orca already cut and marks the cut', () => {
    expect(memberHeadingOf({ displayName: ORCA_CUT }).title).toBe(
      'El lead del juego delega en subagentes internos…'
    )
  })

  it('cuts a title at a word boundary, never mid-word, and never wraps', () => {
    const title = 'El lead del juego delega en subagentes internos'
    expect(fitWords(title, 80)).toBe(title)
    expect(fitWords(title, 20)).toBe('El lead del juego…')
    expect(fitWords(title, 18)).toBe('El lead del juego…')
    expect(fitWords(title, 17)).toBe('El lead del…')
    expect(fitWords('subagentes', 6)).toBe('subag…')
    expect(fitWords(title, 0)).toBe('')
  })

  it('keeps a word boundary in wide glyphs', () => {
    expect(fitWords('修正 カード 表示', 8)).toBe('修正…')
  })

  it('shows a branch without refs/heads/, cut from the left', () => {
    expect(branchLabelOf('refs/heads/feat/orca-604', 40)).toBe('⎇ feat/orca-604')
    expect(branchLabelOf('refs/heads/fabolivark/orca-601-lead-subagents', 16)).toBe(
      '⎇ …ead-subagents'
    )
    expect(branchLabelOf('main', 40)).toBe('⎇ main')
  })

  it('never splits the state: the name gives way first', () => {
    expect(memberHeadOf('ORCA-601', 'trabajando', 30)).toEqual({
      name: 'ORCA-601',
      state: 'trabajando'
    })
    expect(memberHeadOf('ORCA-601', 'trabajando', 16)).toEqual({
      name: 'ORCA…',
      state: 'trabajando'
    })
    expect(memberHeadOf('ORCA-601', 'trabajando', 4).state).toBe('trabajando')
  })

  it('puts the agent, its account and the branch on one dim line that fits', () => {
    const agent = {
      agentType: 'claude',
      account: { provider: 'claude', id: 'a', email: 'fabiana@example.com' },
      worktree: { id: 'w', branch: 'refs/heads/fabolivark/orca-601', displayName: 'orca-601' }
    } as const
    expect(memberMetaOf(agent, 60)).toBe('claude · fabiana@… · ⎇ fabolivark/orca-601')
    expect(memberMetaOf(agent, 34)).toBe('claude · fabiana@… · ⎇ …k/orca-601')
    expect(memberMetaOf({ agentType: 'codex' }, 60)).toBe('codex')
    expect(cellWidthOf(memberMetaOf(agent, 20))).toBeLessThanOrEqual(20)
  })
})
