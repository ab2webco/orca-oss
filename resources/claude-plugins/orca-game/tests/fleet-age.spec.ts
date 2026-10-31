import { afterEach, describe, expect, it } from 'vitest'

import { fleetNoteOf } from '../hooks/fleet-age'
import { setGameLocale } from '../hooks/game-strings'
import type { FleetState, GameState } from '../types'

const STATE = { agents: [] } as unknown as GameState
const MINUTE = 60_000

const fleetAt = (patch: Partial<FleetState>): FleetState => ({
  isLoading: false,
  refreshedAt: 0,
  state: STATE,
  note: '',
  xp: 0,
  ...patch
})

afterEach(() => {
  setGameLocale('en')
})

describe('fleetNoteOf', () => {
  it("keeps the state's own note while the last read answered", () => {
    expect(fleetNoteOf(fleetAt({ note: 'a warning', stateAt: 1000 }), 5 * MINUTE)).toBe('a warning')
  })

  it('says how old the drawn fleet is once a read failed and it kept the old one', () => {
    const v = fleetAt({ isStale: true, stateAt: 10 * MINUTE })

    expect(fleetNoteOf(v, 10 * MINUTE + 40_000)).toBe('updated 40 s ago · retrying')
    expect(fleetNoteOf(v, 12 * MINUTE + 5_000)).toBe('updated 2 min ago · retrying')
    expect(fleetNoteOf(v, 10 * MINUTE + 3 * 60 * MINUTE)).toBe('updated 3 h ago · retrying')
  })

  it('says it in the UI language', () => {
    setGameLocale('es')

    expect(fleetNoteOf(fleetAt({ isStale: true, stateAt: 0 }), 2 * MINUTE)).toBe(
      'actualizado hace 2 min · reintentando'
    )
  })

  it('keeps the unavailable note when there is no fleet to age', () => {
    expect(fleetNoteOf(fleetAt({ state: null, note: 'orca game state unavailable' }), 0)).toBe(
      'orca game state unavailable'
    )
  })

  it('reads an atom an older mod stored, with no age, as fresh', () => {
    expect(fleetNoteOf(fleetAt({ note: '' }), 5 * MINUTE)).toBe('')
  })
})
