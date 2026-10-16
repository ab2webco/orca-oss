import { afterEach, describe, expect, it } from 'vitest'
import { setGameLocale } from '../../../../../resources/claude-plugins/orca-game/hooks/game-strings'
import { sceneGridOf } from '../../../../../resources/claude-plugins/orca-game/hooks/scene'
import { SCENES } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/index'
import {
  PREVIEW_COLUMNS,
  PREVIEW_PHASE_TICKS,
  previewSceneOf,
  scenePreviewFrameOf,
  scenePreviewPixelsOf
} from './orchestrator-game-scene-preview-frame'

afterEach(() => setGameLocale('en'))

describe('previewSceneOf', () => {
  it('draws a built-in scene with the mod definition', () => {
    expect(previewSceneOf({ value: 'jrpg', kind: 'built-in', scene: 'jrpg' })).toBe(SCENES.jrpg)
  })

  it('draws quest for an id nothing installed serves, as the mod does', () => {
    expect(previewSceneOf({ value: 'gone/x', kind: 'missing', scene: 'gone/x' })).toBe(SCENES.quest)
  })

  it('has no definition for a plugin scene in the renderer', () => {
    expect(
      previewSceneOf({ value: 'a.b/c', kind: 'plugin', scene: 'c', pluginName: 'B' })
    ).toBeNull()
  })
})

describe('scenePreviewFrameOf', () => {
  const quest = SCENES.quest!
  const vigilante = SCENES.vigilante!

  it('is the grid the mod paints on the spinner', () => {
    const frame = scenePreviewFrameOf(quest, 0, 'en')
    expect(frame.cells).toEqual(sceneGridOf(quest, undefined, PREVIEW_COLUMNS, 0))
    expect(frame.phase).toBe('working')
    expect(frame.caption).toBe('◆ Squire')
  })

  it('differs between scenes', () => {
    expect(scenePreviewFrameOf(vigilante, 0, 'en').cells).not.toEqual(
      scenePreviewFrameOf(quest, 0, 'en').cells
    )
  })

  it('walks through the phases as ticks pass', () => {
    const next = scenePreviewFrameOf(quest, PREVIEW_PHASE_TICKS, 'en')
    expect(next.phase).toBe('docs')
    expect(next.cells).toEqual(sceneGridOf(quest, 'docs', PREVIEW_COLUMNS, PREVIEW_PHASE_TICKS))
  })

  it('names the character in the UI language', () => {
    expect(scenePreviewFrameOf(quest, 0, 'es').caption).toBe('◆ Escudero')
  })
})

describe('scenePreviewPixelsOf', () => {
  it('unpacks half-block cells into two square pixels', () => {
    const pixels = scenePreviewPixelsOf({
      columns: 2,
      rows: 1,
      cells: [
        [0x2580, 0x112233, 0x445566],
        [0x41, 0xffffff, 0x000000]
      ]
    })
    expect(pixels.width).toBe(2)
    expect(pixels.height).toBe(2)
    expect(pixels.colors).toEqual(['#112233', '#000000', '#445566', '#000000'])
    expect(pixels.glyphs).toEqual([{ column: 1, row: 0, text: 'A', color: '#ffffff' }])
  })
})
