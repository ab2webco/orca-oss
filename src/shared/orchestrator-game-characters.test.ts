import { describe, expect, it } from 'vitest'
import {
  foldFreedMember,
  freedCharacterOf,
  GAME_CHARACTER_RECENT_MAX,
  gameCharacterLevelOf,
  listGameCharacters
} from './orchestrator-game-characters'
import type { GameHistoryRecord } from './orchestrator-game-history'

const freed = (patch: Partial<GameHistoryRecord> = {}): GameHistoryRecord => ({
  ticket: 'CIN-1',
  repo: 'cineco',
  branch: 'cin-1',
  agent: 'claude',
  account: null,
  launchedAt: '2026-10-20T10:00:00.000Z',
  endedAt: '2026-10-20T11:30:00.000Z',
  outcome: 'merged',
  pr: '#41 merged',
  lastReport: null,
  ...patch
})

const arthur = { key: 'arthur', name: 'Arturo' }

describe('foldFreedMember', () => {
  it('adds the ticket, PR, outcome, time worked and XP to the character', () => {
    const next = foldFreedMember({}, arthur, freed())

    expect(listGameCharacters(next ?? {})).toEqual([
      {
        key: 'arthur',
        name: 'Arturo',
        tickets: 1,
        prsOpened: 1,
        prsMerged: 1,
        outcomes: { merged: 1, qa: 0, stopped: 0, failed: 0, limited: 0 },
        workedMs: 90 * 60_000,
        xp: 100,
        lastAt: '2026-10-20T11:30:00.000Z',
        recent: [
          {
            ticket: 'CIN-1',
            outcome: 'merged',
            pr: '#41 merged',
            endedAt: '2026-10-20T11:30:00.000Z',
            workedMs: 90 * 60_000
          }
        ]
      }
    ])
  })

  it('sums tasks and counts no time when the launch time is unknown', () => {
    const one = foldFreedMember({}, arthur, freed())
    const two = foldFreedMember(
      one ?? {},
      { key: 'arthur', name: 'Arthur' },
      freed({
        ticket: 'CIN-2',
        launchedAt: null,
        endedAt: '2026-10-21T09:00:00.000Z',
        outcome: 'qa',
        pr: '#42 open'
      })
    )
    const [character] = listGameCharacters(two ?? {})

    expect(character).toMatchObject({
      name: 'Arthur',
      tickets: 2,
      prsOpened: 2,
      prsMerged: 1,
      outcomes: { merged: 1, qa: 1 },
      workedMs: 90 * 60_000,
      xp: 150
    })
    expect(character?.recent.map((task) => [task.ticket, task.workedMs])).toEqual([
      ['CIN-1', 90 * 60_000],
      ['CIN-2', null]
    ])
  })

  it('returns null when the same task was already folded in', () => {
    const once = foldFreedMember({}, arthur, freed()) ?? {}

    expect(foldFreedMember(once, arthur, freed({ endedAt: '2026-10-20T11:31:00.000Z' }))).toBeNull()
  })

  it('keeps other characters and entries a newer build wrote', () => {
    const stored = { merlin: { key: 'merlin', future: true }, odd: 'not a character' }
    const next = foldFreedMember(stored, arthur, freed()) ?? {}

    expect(next.merlin).toEqual(stored.merlin)
    expect(next.odd).toBe('not a character')
    expect(listGameCharacters(next).map((one) => one.key)).toEqual(['arthur'])
  })

  it('keeps only the newest tasks in the recent list', () => {
    let characters: Record<string, unknown> = {}
    for (let index = 0; index < GAME_CHARACTER_RECENT_MAX + 3; index += 1) {
      characters =
        foldFreedMember(characters, arthur, freed({ ticket: `CIN-${index}`, pr: null })) ??
        characters
    }
    const [character] = listGameCharacters(characters)

    expect(character?.tickets).toBe(GAME_CHARACTER_RECENT_MAX + 3)
    expect(character?.recent).toHaveLength(GAME_CHARACTER_RECENT_MAX)
    expect(character?.recent.at(-1)?.ticket).toBe(`CIN-${GAME_CHARACTER_RECENT_MAX + 2}`)
  })
})

describe('gameCharacterLevelOf', () => {
  it('levels up at 100, then 200 more, as the band does', () => {
    expect(gameCharacterLevelOf(0)).toEqual({ level: 1, into: 0, need: 100 })
    expect(gameCharacterLevelOf(150)).toEqual({ level: 2, into: 50, need: 200 })
    expect(gameCharacterLevelOf(300)).toEqual({ level: 3, into: 0, need: 300 })
  })
})

describe('freedCharacterOf', () => {
  it('keys by the roster key the CLI sent, else by the shown name', () => {
    expect(
      freedCharacterOf({ projectKey: 'repo:a', character: 'Arturo', characterKey: 'arthur' })
    ).toEqual({ key: 'arthur', name: 'Arturo' })
    expect(freedCharacterOf({ projectKey: 'repo:a', character: ' Mario ' })).toEqual({
      key: 'mario',
      name: 'Mario'
    })
  })

  it('records no character outside a project or without a name', () => {
    expect(freedCharacterOf({ projectKey: 'no-project', character: 'Mario' })).toBeNull()
    expect(freedCharacterOf({ projectKey: 'repo:a', character: '  ' })).toBeNull()
    expect(freedCharacterOf({ projectKey: 'repo:a' })).toBeNull()
  })
})
