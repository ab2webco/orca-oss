import { afterEach, describe, expect, it } from 'vitest'

import { gameStateOf } from '../hooks/game-state'
import { setGameLocale } from '../hooks/game-strings'

const bucket = (remaining: number) => ({ limit: 5000, remaining, resetAt: 1, orcaCalls: 3 })
const stateWith = (githubBudget: unknown) =>
  gameStateOf({ config: {}, warnings: [], agents: [], githubBudget })

afterEach(() => {
  setGameLocale('en')
})

describe('GitHub budget in the game state', () => {
  it('keeps the lowest bucket when Orca says the budget is low', () => {
    expect(
      stateWith({ graphql: bucket(400), core: bucket(900), top: [], low: true })?.githubLow
    ).toEqual({ remaining: 400, limit: 5000 })
  })

  it('leaves it out with budget to spare, or from a host that sends none', () => {
    expect(
      'githubLow' in (stateWith({ graphql: bucket(4000), core: bucket(4000), low: false }) ?? {})
    ).toBe(false)
    expect('githubLow' in (stateWith(undefined) ?? {})).toBe(false)
    expect('githubLow' in (stateWith({ low: true, graphql: 'x' }) ?? {})).toBe(false)
  })

  it('survives being read back from the state this mod stored', () => {
    const stored = stateWith({ graphql: bucket(400), core: bucket(900), top: [], low: true })
    expect(gameStateOf(stored)?.githubLow).toEqual({ remaining: 400, limit: 5000 })
  })
})
