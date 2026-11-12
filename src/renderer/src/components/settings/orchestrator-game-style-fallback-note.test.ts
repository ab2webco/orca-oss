import { describe, expect, it } from 'vitest'
import { gameStyleFallbackNote } from './orchestrator-game-style-fallback-note'

describe('gameStyleFallbackNote', () => {
  it('says a themed scene with no art for the style draws its own characters in Pixel', () => {
    expect(gameStyleFallbackNote('figures', 'vigilante', 'Figures')).toBe(
      "This scene has no Figures art, so the Team panel draws the scene's own characters in Pixel."
    )
  })

  it("says a themed scene with no Office art draws Orca's own office", () => {
    expect(gameStyleFallbackNote('office', 'vigilante', 'Office')).toBe(
      "This scene has no Office art, so the Team panel draws Orca's own office."
    )
    expect(gameStyleFallbackNote('office', 'quest', 'Office')).toBeNull()
  })

  it('says nothing where the style draws as picked', () => {
    expect(gameStyleFallbackNote('figures', 'quest', 'Figures')).toBeNull()
    expect(gameStyleFallbackNote('pixel', 'vigilante', 'Pixel')).toBeNull()
  })
})
