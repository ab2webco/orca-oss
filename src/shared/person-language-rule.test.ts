import { describe, expect, it } from 'vitest'

import { personLanguageNameOf } from './person-language-rule'

describe('personLanguageNameOf', () => {
  it('names Spanish for the es locale', () => {
    expect(personLanguageNameOf('es')).toBe('Spanish')
  })

  it('names no language for English or an unknown locale, so the briefs stay as they were', () => {
    expect(personLanguageNameOf('en')).toBeNull()
    expect(personLanguageNameOf(undefined)).toBeNull()
  })
})
