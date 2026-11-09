import { afterEach, describe, expect, it } from 'vitest'
import { i18n } from '@/i18n/i18n'
import { arcadeWordsOf } from './arcade-words'

describe('arcadeWordsOf', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('says one point in the singular, in English and Spanish', async () => {
    await i18n.changeLanguage('en')
    expect(arcadeWordsOf(1).score).toBe('1 pt')
    expect(arcadeWordsOf(1).over).toBe('Game over · 1 pt')
    expect(arcadeWordsOf(3).score).toBe('3 pts')

    await i18n.changeLanguage('es')
    expect(arcadeWordsOf(1).score).toBe('1 pto')
    expect(arcadeWordsOf(1).over).toBe('Fin de la partida · 1 pto')
    expect(arcadeWordsOf(3).score).toBe('3 pts')
  })
})
