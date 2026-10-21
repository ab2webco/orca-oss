import { describe, expect, it } from 'vitest'

import { dayOf } from '../hooks/hd-daylight'
import { mix } from '../hooks/pixel-canvas'
import type { ScenePhase } from '../hooks/scenes/index'
import { sceneDefinitionOf } from '../hooks/scenes/scene-shape'
import { themedSceneOf, themeOfDay } from '../hooks/scenes/scene-theme'
import { ORCHESTRATOR_GAME_SCENE_TEMPLATE } from '../../../../src/shared/orchestrator-game-scene-authoring'

const PHASES: readonly ScenePhase[] = ['working', 'docs', 'build', 'verify', 'pr', 'handoff']
const DUSK = { name: 'Dusk', weight: 0.5, look: { skyTop: '#ff0000', far: 0x0000ff } }
const FROST = { name: { en: 'Frost', es: 'Escarcha' }, weight: 1, look: { ground: '#ffffff' } }

const sceneJson = (themes?: unknown): Record<string, unknown> => {
  const { themes: _template, ...json } = JSON.parse(ORCHESTRATOR_GAME_SCENE_TEMPLATE) as Record<
    string,
    unknown
  >
  return themes === undefined ? json : { ...json, themes }
}

const sceneWith = (themes?: unknown) => {
  const scene = sceneDefinitionOf(sceneJson(themes), 'file:themed.json')
  if (scene === undefined) {
    throw new Error('scene did not parse')
  }
  return scene
}

describe('scene themes in the scene file', () => {
  it('reads valid themes, colors as numbers', () => {
    expect(sceneWith([DUSK, FROST]).themes).toEqual([
      { name: 'Dusk', weight: 0.5, look: { skyTop: 0xff0000, far: 0x0000ff } },
      { name: { en: 'Frost', es: 'Escarcha' }, weight: 1, look: { ground: 0xffffff } }
    ])
  })

  it('keeps a scene without themes exactly as before', () => {
    const scene = sceneWith()
    expect(scene.themes).toBeUndefined()
    expect(themedSceneOf(scene, 20_000)).toBe(scene)
  })

  it('leaves bad themes out and still draws the scene', () => {
    for (const bad of [
      'dusk',
      [],
      [{ ...DUSK, weight: 2 }],
      [{ ...DUSK, look: { far: 'blue' } }],
      [{ ...DUSK, look: {} }],
      [{ weight: 0.5, look: { far: '#000000' } }]
    ]) {
      const scene = sceneDefinitionOf(sceneJson(bad), 'file:bad.json')
      expect(scene?.looks.working).toBeDefined()
      expect(scene?.themes).toBeUndefined()
    }
  })
})

describe('the theme of the day', () => {
  it('rotates through the plain look and each theme, one per day, the same on the same day', () => {
    const scene = sceneWith([DUSK, FROST])
    const week = Array.from({ length: 6 }, (_, day) => themeOfDay(scene, 100 + day)?.weight ?? 0)
    expect(new Set(week)).toEqual(new Set([0, 0.5, 1]))
    expect(week.slice(0, 3)).toEqual(week.slice(3))
    expect(themeOfDay(scene, 101)).toEqual(themeOfDay(scene, 101))
  })

  it('mixes the theme into every phase by its weight, only the colors it names', () => {
    const scene = sceneWith([DUSK])
    const day = [0, 1].find((one) => themeOfDay(scene, one) !== undefined) ?? 0
    const themed = themedSceneOf(scene, day)
    for (const phase of PHASES) {
      const plain = scene.looks[phase]
      expect(themed.looks[phase]).toEqual({
        ...plain,
        skyTop: mix(plain.skyTop, 0xff0000, 0.5),
        far: mix(plain.far, 0x0000ff, 0.5)
      })
    }
    expect(themed.costumes).toBe(scene.costumes)
  })

  it('shows the plain look until the clock is read', () => {
    const scene = sceneWith([DUSK])
    expect(themedSceneOf(scene, undefined)).toBe(scene)
  })
})

describe('the calendar day in a timezone', () => {
  it('counts days since 1970 on the zone’s own calendar', () => {
    // 2026-10-21 03:00 UTC is still 2026-10-20 in Bogota.
    const at = Date.UTC(2026, 9, 21, 3)
    expect(dayOf(at, 'UTC')).toBe(Date.UTC(2026, 9, 21) / 86_400_000)
    expect(dayOf(at, 'America/Bogota')).toBe(Date.UTC(2026, 9, 20) / 86_400_000)
  })
})
