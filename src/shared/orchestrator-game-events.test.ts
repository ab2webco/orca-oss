import { describe, expect, it } from 'vitest'
import {
  GAME_EVENTS_MAX,
  appendGameEvent,
  filterGameEvents,
  gameMergesOf,
  parseGameEvent,
  type GameEvent
} from './orchestrator-game-events'

const event = (
  ticket: string | null,
  at: string,
  kind: GameEvent['kind'] = 'claimed'
): GameEvent => ({
  at,
  kind,
  ticket,
  text: null,
  by: 'lead'
})

describe('game events', () => {
  it('keeps the newest events up to the bound', () => {
    let events: GameEvent[] = []
    for (let at = 0; at < GAME_EVENTS_MAX + 5; at += 1) {
      events = appendGameEvent(events, event(`CIN-${at}`, new Date(at * 1000).toISOString())).events
    }
    expect(events).toHaveLength(GAME_EVENTS_MAX)
    expect(events[0]?.ticket).toBe('CIN-5')
    expect(events.at(-1)?.ticket).toBe(`CIN-${GAME_EVENTS_MAX + 4}`)
  })

  it('adds an event with a dedupe key once, and every event without one', () => {
    const merged = {
      ...event('CIN-1', '2026-10-16T10:00:00.000Z', 'merged'),
      key: 'merged CIN-1 #41'
    }
    const first = appendGameEvent([], merged)
    const again = appendGameEvent(first.events, { ...merged, at: '2026-10-16T11:00:00.000Z' })
    expect(first.added).toBe(true)
    expect(again.added).toBe(false)
    expect(again.events).toHaveLength(1)

    const plain = appendGameEvent(
      again.events,
      event('CIN-1', '2026-10-16T12:00:00.000Z', 'failed')
    )
    const twice = appendGameEvent(
      plain.events,
      event('CIN-1', '2026-10-16T12:00:00.000Z', 'failed')
    )
    expect(twice.events).toHaveLength(3)
  })

  it('filters by ticket and by time, newest first', () => {
    const events = [
      event('CIN-1', '2026-10-14T10:00:00.000Z'),
      event('CIN-2', '2026-10-15T10:00:00.000Z'),
      event('CIN-1', '2026-10-16T10:00:00.000Z', 'merged')
    ]
    expect(filterGameEvents(events, { ticket: 'cin-1' }).map((one) => one.kind)).toEqual([
      'merged',
      'claimed'
    ])
    expect(filterGameEvents(events, { since: '2026-10-15' }).map((one) => one.ticket)).toEqual([
      'CIN-1',
      'CIN-2'
    ])
  })

  it('accepts a well-formed event over the wire and refuses the rest', () => {
    const good = { ...event('CIN-1', '2026-10-16T10:00:00.000Z', 'pr_opened'), text: 'PR #41' }
    expect(parseGameEvent(good)).toEqual(good)
    expect(parseGameEvent({ ...good, kind: 'exploded' })).toBeNull()
    expect(parseGameEvent({ ...good, at: 'yesterday' })).toBeNull()
    expect(parseGameEvent({ ...good, text: 'x'.repeat(5000) })?.text).toHaveLength(600)
    expect(parseGameEvent({ ...good, key: 'pr CIN-1' })?.key).toBe('pr CIN-1')
    expect(parseGameEvent('CIN-1')).toBeNull()
  })

  it("keeps a merged event's review, and drops only a review it cannot read", () => {
    const merge = { provider: 'gitlab', number: 7, worktreeId: 'wt-1', perfect: false }
    const merged = { ...event('CIN-1', '2026-10-16T10:00:00.000Z', 'merged'), key: 'k', merge }
    expect(parseGameEvent(merged)).toEqual(merged)
    expect(parseGameEvent({ ...merged, merge: { ...merge, perfect: 'yes' } })).not.toHaveProperty(
      'merge'
    )
    expect(parseGameEvent({ ...merged, merge: { ...merge, provider: 'svn' } })?.key).toBe('k')
    expect(parseGameEvent({ ...merged, kind: 'failed' })).not.toHaveProperty('merge')
  })

  it('lists the newest merges with their review, oldest first', () => {
    const merge = { provider: 'github' as const, number: 4, worktreeId: 'wt-1', perfect: true }
    const at = '2026-10-16T10:00:00.000Z'
    const events: GameEvent[] = [
      { ...event('CIN-1', at, 'merged'), key: 'merged CIN-1 #4', merge },
      { ...event('CIN-2', at, 'merged'), key: 'merged CIN-2 #5' },
      { ...event('CIN-3', at, 'merged'), key: 'merged CIN-3 #6', merge: { ...merge, number: 6 } }
    ]
    expect(gameMergesOf(events, 5).map((one) => [one.key, one.ticket, one.number])).toEqual([
      ['merged CIN-1 #4', 'CIN-1', 4],
      ['merged CIN-3 #6', 'CIN-3', 6]
    ])
    expect(gameMergesOf(events, 1).map((one) => one.number)).toEqual([6])
  })
})
