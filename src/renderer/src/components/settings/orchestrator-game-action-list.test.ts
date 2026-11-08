import { describe, expect, it } from 'vitest'
import {
  EMPTY_ACTION_DRAFT,
  actionDraftOf,
  actionsOfDrafts
} from './orchestrator-game-action-drafts'
import {
  actionCommandOf,
  movedUp,
  orcaActionRowsOf,
  withNewActionFirst,
  withPinToggled
} from './orchestrator-game-action-list'

const draft = (label: string, pin = false) => ({
  ...EMPTY_ACTION_DRAFT,
  label,
  command: actionCommandOf(label),
  prompt: label,
  pin
})

describe('the Settings action list, as V30 edits it', () => {
  it('derives the command from the name: lowercase, no accents, starting with a letter', () => {
    expect(actionCommandOf('PRs en rojo')).toBe('prs-en-rojo')
    expect(actionCommandOf('  Déploy à Staging! ')).toBe('deploy-a-staging')
    expect(actionCommandOf('2 Tests')).toBe('tests')
    expect(actionCommandOf('A very long action name over the limit')).toBe(
      'a-very-long-action-name'
    )
  })

  it('puts a new action first, pinned while the row has room for it', () => {
    const three = [draft('A', true), draft('B', true), draft('C', true)]
    expect(
      withNewActionFirst([draft('A', true)], draft('New')).map((one) => [one.label, one.pin])
    ).toEqual([
      ['New', true],
      ['A', true]
    ])
    expect(withNewActionFirst(three, draft('New'))[0]).toMatchObject({ label: 'New', pin: false })
  })

  it('moves a row up, and refuses a fourth pin', () => {
    const list = [draft('A', true), draft('B', true), draft('C', true), draft('D')]
    expect(movedUp(list, 2).map((one) => one.label)).toEqual(['A', 'C', 'B', 'D'])
    expect(movedUp(list, 0)).toBe(list)
    expect(withPinToggled(list, 3)).toBe('full')
    expect((withPinToggled(list, 0) as typeof list)[0]?.pin).toBe(false)
  })

  it('keeps the icon, pin, key and MCP arguments it does not show through a save', () => {
    const saved = {
      label: 'Board',
      command: 'board',
      key: 'x',
      icon: 'list' as const,
      pin: true,
      mcp: { server: 'plane', tool: 'list', args: { project: 'ORCA' } }
    }
    expect(actionsOfDrafts([actionDraftOf(saved)]).actions).toEqual([saved])
  })

  it("lists Orca's actions in V30's order with the project's changes, stop always on", () => {
    const rows = orcaActionRowsOf(
      { wave: { enabled: false }, stop: { label: 'Halt' } },
      { sweep: { prompt: 'Close only with CI green.', icon: 'scan' } }
    )
    expect(rows.map((one) => [one.id, one.label, one.icon, one.enabled])).toEqual([
      ['wave', 'Wave', 'launch', false],
      ['push', 'Push', 'play', true],
      ['sweep', 'Sweep', 'scan', true],
      ['status', 'Status', 'pulse', true],
      ['stop', 'Halt', 'stop', true]
    ])
    expect(rows[2]?.prompt).toBe('Close only with CI green.')
  })
})
