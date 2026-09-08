import { describe, expect, it } from 'vitest'
import {
  memberInitials,
  planeAssigneeOptions,
  toggledAssignees
} from './plane-assignee-picker-options'

const ADA = { id: 'u-1', displayName: 'Ada Lovelace' }
const GRACE = { id: 'u-2', displayName: 'Grace Hopper' }
const NAMELESS = { id: 'u-3', displayName: '' }
const LINUS = { id: 'u-4', displayName: 'Linus' }

describe('memberInitials', () => {
  it('takes the first letter of the first two words, upper-cased', () => {
    expect(memberInitials('Ada Lovelace')).toBe('AL')
    expect(memberInitials('ada')).toBe('A')
    expect(memberInitials('  grace   brewster hopper ')).toBe('GB')
  })

  it('reads ? for an empty name', () => {
    expect(memberInitials('')).toBe('?')
    expect(memberInitials('   ')).toBe('?')
  })
})

describe('planeAssigneeOptions', () => {
  const members = [ADA, GRACE, NAMELESS, LINUS]

  it('lists the assigned members first, keeping member order within each group', () => {
    const options = planeAssigneeOptions(members, [LINUS, GRACE], '')
    expect(options.map((option) => [option.member.id, option.assigned])).toEqual([
      ['u-2', true],
      ['u-4', true],
      ['u-1', false],
      ['u-3', false]
    ])
  })

  it('filters by a case-insensitive substring of the name', () => {
    expect(planeAssigneeOptions(members, [], 'HOP').map((option) => option.member.id)).toEqual([
      'u-2'
    ])
    expect(planeAssigneeOptions(members, [], '  ').map((option) => option.member.id)).toEqual([
      'u-1',
      'u-2',
      'u-3',
      'u-4'
    ])
  })

  it('reads an empty name as "Unnamed member" for display and for matching', () => {
    const options = planeAssigneeOptions(members, [], 'unnamed')
    expect(options.map((option) => option.member.id)).toEqual(['u-3'])
    expect(options[0]?.name).toBe('Unnamed member')
  })
})

describe('toggledAssignees', () => {
  it('adds a member that is not assigned and removes one that is', () => {
    expect(toggledAssignees([ADA], GRACE)).toEqual([ADA, GRACE])
    expect(toggledAssignees([ADA, GRACE], ADA)).toEqual([GRACE])
  })
})
