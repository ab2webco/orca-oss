import { describe, expect, it } from 'vitest'

import { cellWidthOf } from '../hooks/cell-width'
import { memberHeadOf, memberMetaOf } from '../hooks/fleet-labels'
import { cardLayoutOf, TILE_COLUMNS } from '../hooks/fleet-tiles'
import { setGameLocale } from '../hooks/game-strings'

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
  it('shows the ticket and host in full on a 320 px pane', () => {
    setGameLocale('en')
    const { room } = cardLayoutOf(38)
    const head = memberHeadOf('LUM-14', 'working', room, room)
    expect(head.name).toBe('LUM-14')
    const silent = {
      agentType: '',
      remote: { host: 'imac', stateKnown: false }
    } as const
    expect(memberMetaOf(silent, room)).toContain('imac not answering')
    const meta = memberMetaOf(
      {
        ...silent,
        worktree: { id: 'w', branch: 'feat/lum-15', displayName: 'LUM-15' }
      },
      room
    )
    expect(meta).toMatch(/^imac/)
    expect(cellWidthOf(meta)).toBeLessThanOrEqual(room)
  })

  it('never reports less than one cell of room', () => {
    expect(cardLayoutOf(1).room).toBe(1)
  })
})
