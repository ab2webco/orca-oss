import { describe, expect, it } from 'vitest'
import { TEAM_SHEET_FLING_VELOCITY, teamSheetOffsetOf, teamSheetSnapOf } from './team-sheet-snap'

// travel: how far the open sheet slides down to its peek (offset 0 = open, offset travel = peek).
const travel = 600

describe('teamSheetSnapOf', () => {
  it('rests at the nearer snap point when let go slowly', () => {
    expect(teamSheetSnapOf(100, travel, 0)).toBe('open')
    expect(teamSheetSnapOf(299, travel, 120)).toBe('open')
    expect(teamSheetSnapOf(300, travel, 0)).toBe('peek')
    expect(teamSheetSnapOf(500, travel, -120)).toBe('peek')
  })

  it('follows a fling in its direction, wherever the sheet is', () => {
    expect(teamSheetSnapOf(550, travel, -TEAM_SHEET_FLING_VELOCITY)).toBe('open')
    expect(teamSheetSnapOf(40, travel, TEAM_SHEET_FLING_VELOCITY)).toBe('peek')
    expect(teamSheetSnapOf(590, travel, -1800)).toBe('open')
    expect(teamSheetSnapOf(10, travel, 1800)).toBe('peek')
  })

  it('treats a velocity just under the fling threshold as a slow release', () => {
    expect(teamSheetSnapOf(550, travel, -(TEAM_SHEET_FLING_VELOCITY - 1))).toBe('peek')
    expect(teamSheetSnapOf(40, travel, TEAM_SHEET_FLING_VELOCITY - 1)).toBe('open')
  })

  it('stays at the peek when there is no room to open', () => {
    expect(teamSheetSnapOf(0, 0, -1800)).toBe('peek')
  })
})

describe('teamSheetOffsetOf', () => {
  it('moves the sheet with the finger from where the drag started', () => {
    expect(teamSheetOffsetOf(travel, -250, travel)).toBe(350)
    expect(teamSheetOffsetOf(0, 120, travel)).toBe(120)
  })

  it('keeps the sheet between open and peek', () => {
    expect(teamSheetOffsetOf(0, -80, travel)).toBe(0)
    expect(teamSheetOffsetOf(travel, 80, travel)).toBe(travel)
  })
})
