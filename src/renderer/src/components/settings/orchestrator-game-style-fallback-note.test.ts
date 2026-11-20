import { describe, expect, it } from 'vitest'
import { gameStyleFallbackNote } from './orchestrator-game-style-fallback-note'

describe('gameStyleFallbackNote', () => {
  it.each([
    ['figures', 'Figures'],
    ['office', 'Office']
  ] as const)('says a themed scene leaves %s as Orca draws it', (style, label) => {
    for (const sceneId of ['vigilante', 'file:.orca/scenes/mario.json', 'acme.pack/space']) {
      expect(gameStyleFallbackNote(style, sceneId, label)).toBe(
        `${label} always draws Orca's own art; this scene changes Pixel only.`
      )
    }
  })

  it('says nothing for Quest, whose art Orca draws, or for Pixel, which the scene themes', () => {
    expect(gameStyleFallbackNote('figures', 'quest', 'Figures')).toBeNull()
    expect(gameStyleFallbackNote('office', 'file:.orca/scenes/quest.json', 'Office')).toBeNull()
    expect(gameStyleFallbackNote('pixel', 'vigilante', 'Pixel')).toBeNull()
  })
})
