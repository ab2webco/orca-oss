import { describe, expect, it } from 'vitest'

import { hasStartedLead, isGameLeadCommand, isMadeLeadOutput } from '../hooks/lead-started'

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
  it.each([
    '"$ORCA_GAME_CLI" game lead',
    'orca game lead --json',
    "'/opt/orca dev/orca-dev' game lead"
  ])('recognizes the lead rules fetch in %s', (command) => {
    expect(isGameLeadCommand(command)).toBe(true)
  })

  it('ignores other game commands and similar words', () => {
    expect(isGameLeadCommand('orca game state')).toBe(false)
    expect(isGameLeadCommand('orca game leader-board')).toBe(false)
    expect(isGameLeadCommand('orca game launch PR-1')).toBe(false)
    expect(isGameLeadCommand(undefined)).toBe(false)
  })
})

describe('isMadeLeadOutput', () => {
  it('counts the lead rules as making this session the lead', () => {
    expect(isMadeLeadOutput({ stdout: 'You are the lead of cineco.\n...' })).toBe(true)
    expect(
      isMadeLeadOutput({
        stdout:
          "Orca could not reopen cineco's previous lead conversation (x), so this session is a new lead."
      })
    ).toBe(true)
  })

  it('does not count a pane told the lead lives elsewhere, or a failed call', () => {
    expect(
      isMadeLeadOutput({ stdout: "Not the lead: cineco's lead is live in another pane (term_a)" })
    ).toBe(false)
    expect(isMadeLeadOutput({ stdout: '{"ok": true, "result": {"outcome": "resumed"}}' })).toBe(
      false
    )
    expect(isMadeLeadOutput({ stdout: '', stderr: 'boom', interrupted: false })).toBe(false)
    expect(isMadeLeadOutput(undefined)).toBe(false)
  })
})
