import { afterEach, describe, expect, it } from 'vitest'

import { arcadeCaptionOf } from '../hooks/arcade-loop'
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
})
