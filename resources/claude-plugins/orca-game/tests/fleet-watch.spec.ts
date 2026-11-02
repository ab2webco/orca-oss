import { describe, expect, it } from 'vitest'

import { fleetLinesOf } from '../hooks/fleet-watch'
import { gameWatchArgvOf } from '../hooks/game-config'

describe('fleetLinesOf', () => {
  it('reads every whole line of `orca game watch` and keeps a cut one for the next piece', () => {
    const first = fleetLinesOf('', 'ready 3\nfleet 4\nfle')
    expect(first).toEqual({ ready: true, changes: 1, rest: 'fle' })

    expect(fleetLinesOf(first.rest, 'et 5\r\n')).toEqual({ ready: false, changes: 1, rest: '' })
  })

  it('ignores lines it does not know, so a newer CLI can say more', () => {
    expect(fleetLinesOf('', 'keepalive\nfleet 9 launch\n')).toEqual({
      ready: false,
      changes: 1,
      rest: ''
    })
  })
})

describe('gameWatchArgvOf', () => {
  it('runs only the absolute CLI path Orca handed over', () => {
    expect(gameWatchArgvOf('/opt/orca/bin/orca')).toEqual(['/opt/orca/bin/orca', 'game', 'watch'])
    expect(gameWatchArgvOf('orca')).toBeUndefined()
  })
})
