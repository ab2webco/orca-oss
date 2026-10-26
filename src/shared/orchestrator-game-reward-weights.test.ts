import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GAME_REWARD_KINDS,
  DEFAULT_GAME_REWARD_WEIGHTS,
  GAME_REWARD_WEIGHT_MAX,
  parseGameRewardWeights,
  resolveGameRewardWeights
} from './orchestrator-game-reward-weights'

describe('parseGameRewardWeights', () => {
  it('keeps a whole-number weight per known reward, 0 included', () => {
    expect(parseGameRewardWeights({ 'ci-green': 5, 'member-claimed': 0 })).toEqual({
      value: { 'ci-green': 5, 'member-claimed': 0 },
      warnings: []
    })
  })

  it('warns and drops a weight that is negative, fractional, too large or not a number', () => {
    const parsed = parseGameRewardWeights({
      'review-merged': -1,
      'ci-green': 2.5,
      'work-item-review': GAME_REWARD_WEIGHT_MAX + 1,
      'work-item-done': '70'
    })

    expect(parsed.value).toEqual({})
    expect(parsed.warnings).toEqual(
      ['review-merged', 'ci-green', 'work-item-review', 'work-item-done'].map(
        (kind) =>
          `orchestratorGame.rewardWeights.${kind} must be a whole number from 0 to ${GAME_REWARD_WEIGHT_MAX}`
      )
    )
  })

  it('warns on a reward it does not know and on a value that is not a mapping', () => {
    expect(parseGameRewardWeights({ 'pr-opened': 5 }).warnings).toEqual([
      'orchestratorGame.rewardWeights.pr-opened is not a known reward'
    ])
    expect(parseGameRewardWeights([1, 2])).toEqual({
      value: undefined,
      warnings: ['orchestratorGame.rewardWeights must be a mapping']
    })
  })
})

describe('resolveGameRewardWeights', () => {
  it('is the baseline table with no layer', () => {
    expect(resolveGameRewardWeights([])).toEqual({
      'review-merged': 100,
      'ci-green': 20,
      'work-item-review': 50,
      'work-item-done': 70,
      'member-claimed': 10,
      'perfect-merge': 100
    })
    expect(resolveGameRewardWeights([undefined, undefined])).toEqual(DEFAULT_GAME_REWARD_WEIGHTS)
  })

  it('merges key by key, a later layer winning, and skips a hand-edited invalid value', () => {
    const weights = resolveGameRewardWeights([
      { 'ci-green': 5, 'review-merged': 150 },
      { 'member-claimed': 0 },
      { 'ci-green': 8, 'work-item-done': -3 } as Record<string, number>
    ])

    expect(weights).toEqual({
      ...DEFAULT_GAME_REWARD_WEIGHTS,
      'review-merged': 150,
      'ci-green': 8,
      'member-claimed': 0
    })
  })
})

describe('the documented scoring table', () => {
  it('lists every reward with its default', () => {
    const doc = readFileSync(
      join(__dirname, '../../docs/reference/orchestrator-game.md'),
      'utf8'
    ).replace(/\r\n/g, '\n')
    const table = doc.split('### The scoring table')[1]?.split('\n\n')[2] ?? ''

    const rows = table
      .split('\n')
      .slice(2)
      .map((line) => line.split('|').map((cell) => cell.trim()))
      .map((cells) => [cells[1]?.replaceAll('`', ''), Number(cells.at(-2))])

    expect(Object.fromEntries(rows)).toEqual(DEFAULT_GAME_REWARD_WEIGHTS)
    expect(rows.map(([kind]) => kind)).toEqual([...GAME_REWARD_KINDS])
  })
})
