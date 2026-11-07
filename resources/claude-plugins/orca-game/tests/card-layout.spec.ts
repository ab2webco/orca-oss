import { describe, expect, it } from 'vitest'

import { cardLayoutOf, TILE_COLUMNS } from '../hooks/fleet-tiles'

describe('member card layout', () => {
  it('keeps the tile beside the text on a desktop pane', () => {
    expect(cardLayoutOf(120)).toEqual({
      withTile: true,
      room: 120 - TILE_COLUMNS - 4
    })
  })

  it('drops the tile on a phone pane so the text column takes the width', () => {
    expect(cardLayoutOf(38)).toEqual({ withTile: false, room: 34 })
  })

  // ORCA-827: at 320 px the remote card read `working · imac · …` with no ticket.

  it('never reports less than one cell of room', () => {
    expect(cardLayoutOf(1).room).toBe(1)
  })
})
