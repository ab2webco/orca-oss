import { describe, expect, it } from 'vitest'
import { applyLifeEvent, LIVES_MAX, LIVES_START, livesOf, type LivesBook } from './lives-rules'

const play = (events: Parameters<typeof applyLifeEvent>[1][]): LivesBook =>
  events.reduce<LivesBook>((book, event) => applyLifeEvent(book, event).book, {})

describe('lives rules', () => {
  it('starts every member at the start count', () => {
    expect(livesOf({}, 'ana')).toEqual({ lives: LIVES_START, benched: false })
  })

  it('earns a life for a merge whose CI is green', () => {
    const book = play([
      { id: 'pr1:green', member: 'ana', kind: 'ci-green' },
      { id: 'pr1:merged', member: 'ana', kind: 'merged' }
    ])
    expect(livesOf(book, 'ana').lives).toBe(LIVES_START + 1)
  })

  it('earns nothing for a merge while CI is red or unknown', () => {
    const red = play([
      { id: 'pr1:red', member: 'ana', kind: 'ci-red' },
      { id: 'pr1:merged', member: 'ana', kind: 'merged' }
    ])
    expect(livesOf(red, 'ana').lives).toBe(LIVES_START - 1)
    const unknown = play([{ id: 'pr1:merged', member: 'bo', kind: 'merged' }])
    expect(livesOf(unknown, 'bo').lives).toBe(LIVES_START)
  })

  it('costs one life when CI turns red, not on every red poll', () => {
    const book = play([
      { id: 'pr1:red:1', member: 'ana', kind: 'ci-red' },
      { id: 'pr1:red:2', member: 'ana', kind: 'ci-red' }
    ])
    expect(livesOf(book, 'ana').lives).toBe(LIVES_START - 1)
  })

  it('gives nothing back for a green CI after red', () => {
    const book = play([
      { id: 'pr1:red', member: 'ana', kind: 'ci-red' },
      { id: 'pr1:green', member: 'ana', kind: 'ci-green' }
    ])
    expect(livesOf(book, 'ana').lives).toBe(LIVES_START - 1)
  })

  it('costs one life for a revert', () => {
    const book = play([{ id: 'pr1:reverted', member: 'ana', kind: 'reverted' }])
    expect(livesOf(book, 'ana').lives).toBe(LIVES_START - 1)
  })

  it('never counts the same event twice', () => {
    const once = applyLifeEvent({}, { id: 'pr1:reverted', member: 'ana', kind: 'reverted' })
    const twice = applyLifeEvent(once.book, { id: 'pr1:reverted', member: 'ana', kind: 'reverted' })
    expect(twice.delta).toBe(0)
    expect(livesOf(twice.book, 'ana').lives).toBe(LIVES_START - 1)
  })

  it('caps at the maximum', () => {
    const merges = Array.from({ length: 6 }, (_, i) => [
      { id: `pr${i}:green`, member: 'ana', kind: 'ci-green' as const },
      { id: `pr${i}:merged`, member: 'ana', kind: 'merged' as const }
    ]).flat()
    expect(livesOf(play(merges), 'ana').lives).toBe(LIVES_MAX)
  })

  it('benches a member at zero and a green merge brings it back', () => {
    const losses = Array.from({ length: LIVES_START + 2 }, (_, i) => ({
      id: `pr${i}:reverted`,
      member: 'ana',
      kind: 'reverted' as const
    }))
    const benched = play(losses)
    expect(livesOf(benched, 'ana')).toEqual({ lives: 0, benched: true })
    const back = play([
      ...losses,
      { id: 'pr9:green', member: 'ana', kind: 'ci-green' },
      { id: 'pr9:merged', member: 'ana', kind: 'merged' }
    ])
    expect(livesOf(back, 'ana')).toEqual({ lives: 1, benched: false })
  })

  it('reports the delta so the band can animate it', () => {
    expect(applyLifeEvent({}, { id: 'a', member: 'ana', kind: 'reverted' }).delta).toBe(-1)
    expect(applyLifeEvent({}, { id: 'b', member: 'ana', kind: 'ci-green' }).delta).toBe(0)
  })
})
