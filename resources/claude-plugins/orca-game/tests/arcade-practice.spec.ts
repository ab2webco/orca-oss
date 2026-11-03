import { afterEach, describe, expect, it } from 'vitest'

import { arcadeCaptionOf } from '../hooks/arcade-loop'
import { RUNNER_LEVEL_MS } from '../hooks/arcade-runner-course'
import { arcadeWords } from '../hooks/arcade-words'
import { gameCommandOf } from '../hooks/game-commands'
import { setGameLocale } from '../hooks/game-strings'
import { questCommandOf } from '../hooks/quest-policy'

afterEach(() => setGameLocale('en'))

describe('the arcade practice entry', () => {
  it('is the demo command with the word arcade, from both commands', () => {
    expect(gameCommandOf('orca-game:demo', 'arcade')).toEqual({ arcade: true })
    expect(gameCommandOf('orca-game:demo', ' Arcade ')).toEqual({ arcade: true })
    expect(questCommandOf('demo arcade')).toEqual({ arcade: true })
    expect(gameCommandOf('orca-game:demo', '')).toEqual({ demo: true })
    expect(questCommandOf('demo')).toEqual({ demo: true })
  })

  it('says what the one key does on every screen, in both languages', () => {
    for (const locale of ['en', 'es'] as const) {
      setGameLocale(locale)
      for (const screen of ['ready', 'paused', 'over'] as const) {
        expect(arcadeCaptionOf(screen, 12), `${locale} ${screen}`).toMatch(/\bj\b/)
      }
      expect(arcadeCaptionOf('running', 12)).toBeUndefined()
      expect(arcadeCaptionOf('over', 12)).toContain('12')
    }
  })

  it('names each new level for a moment while running, and a new best when the run ends', () => {
    for (const locale of ['en', 'es'] as const) {
      setGameLocale(locale)
      const levelUp = { level: 3, ms: 2 * RUNNER_LEVEL_MS + 500, best: 0 }
      expect(arcadeCaptionOf('running', 40, levelUp), locale).toBe(arcadeWords().level(3))
      expect(arcadeCaptionOf('running', 40, { ...levelUp, ms: levelUp.ms + 3000 })).toBeUndefined()
      expect(arcadeCaptionOf('running', 4, { level: 1, ms: 500, best: 0 })).toBeUndefined()
      expect(arcadeCaptionOf('over', 40, { ...levelUp, best: 30 })).toBe(arcadeWords().best(40))
      expect(arcadeCaptionOf('over', 20, { ...levelUp, best: 30 })).toBe(arcadeWords().over(20))
      expect(arcadeWords().best(40)).toMatch(/\bj\b/)
    }
  })
})
