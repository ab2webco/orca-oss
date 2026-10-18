import { describe, expect, it } from 'vitest'

import { hasStartedLead, isGameLeadCommand } from '../hooks/lead-started'

describe('hasStartedLead', () => {
  it('finds this session in the lead-started record', () => {
    expect(hasStartedLead(['other', 'session-a'], 'session-a')).toBe(true)
  })

  it('does not treat another session as a lead', () => {
    expect(hasStartedLead(['session-b'], 'session-a')).toBe(false)
  })

  it('reads an empty or unset record as no lead', () => {
    expect(hasStartedLead(undefined, 'session-a')).toBe(false)
    expect(hasStartedLead('session-a', 'session-a')).toBe(false)
  })
})

describe('isGameLeadCommand', () => {
  it.each(['"$ORCA_GAME_CLI" game lead', 'orca game lead --json', "'/opt/orca dev/orca-dev' game lead"])(
    'recognizes the lead rules fetch in %s',
    (command) => {
      expect(isGameLeadCommand(command)).toBe(true)
    }
  )

  it('ignores other game commands and similar words', () => {
    expect(isGameLeadCommand('orca game state')).toBe(false)
    expect(isGameLeadCommand('orca game leader-board')).toBe(false)
    expect(isGameLeadCommand('orca game launch PR-1')).toBe(false)
    expect(isGameLeadCommand(undefined)).toBe(false)
  })
})
