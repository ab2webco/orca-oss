import { afterEach, describe, expect, it } from 'vitest'

import { menuChipsOf } from '../hooks/band-chips'
import { gameCommandOf } from '../hooks/game-commands'
import { gameConfigOfEnv, isAbsorbingConfig } from '../hooks/game-config'
import { setGameLocale } from '../hooks/game-strings'
import { isSceneMode, questCommandOf } from '../hooks/quest-policy'
import { sceneOf } from '../hooks/scenes/index'

afterEach(() => setGameLocale('en'))

describe('the flat mode', () => {
  it('is a mode of its own, from the env and both commands', () => {
    expect(gameConfigOfEnv({ ORCA_GAME_MODE: 'flat' }).mode).toBe('flat')
    expect(questCommandOf('flat')).toEqual({ mode: 'flat' })
    expect(gameCommandOf('orca-game:mode', 'flat')).toEqual({ mode: 'flat' })
  })

  it('draws no scene but still holds the allies strip', () => {
    expect(isSceneMode('flat')).toBe(false)
    expect(isSceneMode('off')).toBe(false)
    expect(isSceneMode('on') && isSceneMode('zen')).toBe(true)
    expect(isAbsorbingConfig({ ...gameConfigOfEnv({}), mode: 'flat' })).toBe(true)
  })

  it('names flat in the mode help and the unknown-mode answer, in both languages', () => {
    for (const locale of ['en', 'es'] as const) {
      setGameLocale(locale)
      const asked = questCommandOf('nope')
      expect('error' in asked && asked.error, locale).toContain('/orca-game:mode flat')
    }
  })
})

describe('the band menu', () => {
  const scene = sceneOf('quest')
  const keysOf = (isFlat: boolean) => menuChipsOf(scene, isFlat).map((chip) => chip.key)

  it('offers the text view beside Pet while the scene draws', () => {
    expect(keysOf(false)).toEqual(['band-panel', 'band-refresh', 'band-flat', 'band-pet'])
    expect(menuChipsOf(scene, false)[2]?.labels).toEqual(['≡ Text', '≡'])
  })

  it('offers the scene back and drops Pet, which only the scene draws', () => {
    expect(keysOf(true)).toEqual(['band-panel', 'band-refresh', 'band-flat'])
    setGameLocale('es')
    expect(menuChipsOf(scene, true)[2]?.labels).toEqual(['▦ Escena', '▦'])
  })
})
