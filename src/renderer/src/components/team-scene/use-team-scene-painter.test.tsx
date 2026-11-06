// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GamePanelStyle } from '../../../../shared/orchestrator-game-panel'
import type { OrchestratorGameSceneExtension } from '../../../../shared/orchestrator-game-scene'
import { loadTeamSceneArt } from './team-scene-art-load'
import { createImagePainter } from './team-scene-image-painter'
import { createPixelPainter } from './team-scene-pixel-painter'
import type { TeamScenePainter } from './team-scene-painter'
import { teamSceneQuestArtOf } from './team-scene-quest-art'
import {
  teamSceneDrawnStyleOf,
  useTeamScenePainter,
  type TeamScenePainterArgs
} from './use-team-scene-painter'

vi.mock('./team-scene-art-load', () => ({ loadTeamSceneArt: vi.fn() }))
vi.mock('./team-scene-image-painter', () => ({ createImagePainter: vi.fn() }))
vi.mock('./team-scene-pixel-painter', () => ({ createPixelPainter: vi.fn() }))
vi.mock('./team-scene-pixel-scene', () => ({ teamScenePixelSceneOf: vi.fn(() => ({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const art = (style: 'figures' | 'office') => ({
  style: teamSceneQuestArtOf(style),
  images: new Map()
})
const blockScene = (id: string): OrchestratorGameSceneExtension =>
  ({
    id,
    pluginId: 'plugin',
    definition: { native: { figures: teamSceneQuestArtOf('figures') } }
  }) as unknown as OrchestratorGameSceneExtension

const QUEST = { id: 'quest', extensions: [] }

describe('teamSceneDrawnStyleOf', () => {
  it('draws Quest in its bundled art', () => {
    expect(teamSceneDrawnStyleOf({ style: 'figures', scene: QUEST })).toBe('figures')
    expect(teamSceneDrawnStyleOf({ style: 'office', scene: QUEST })).toBe('office')
  })

  it('reads a host that named no scene as Quest, as Pixel does', () => {
    expect(teamSceneDrawnStyleOf({ style: 'office', scene: { id: null, extensions: [] } })).toBe(
      'office'
    )
  })

  it('draws Pixel when Pixel or Soft is asked for', () => {
    expect(teamSceneDrawnStyleOf({ style: 'pixel', scene: QUEST })).toBe('pixel')
    expect(teamSceneDrawnStyleOf({ style: 'soft', scene: QUEST })).toBe('pixel')
  })

  it('falls to Pixel for a scene with a native block, whose images the panel cannot read yet', () => {
    const scene = { id: 'file:mine.json', extensions: [blockScene('file:mine.json')] }
    expect(teamSceneDrawnStyleOf({ style: 'figures', scene })).toBe('pixel')
  })

  it('draws Pixel for another scene with no art', () => {
    expect(
      teamSceneDrawnStyleOf({ style: 'figures', scene: { id: 'other', extensions: [] } })
    ).toBe('pixel')
  })

  it('falls to Pixel when the bundled art failed', () => {
    expect(teamSceneDrawnStyleOf({ style: 'figures', scene: QUEST, artFailed: true })).toBe('pixel')
  })
})

describe('useTeamScenePainter', () => {
  const PIXEL = { height: 1 } as TeamScenePainter
  const IMAGE = { height: 2 } as TeamScenePainter
  let root: Root
  let seen: (TeamScenePainter | null)[]

  function Probe(props: TeamScenePainterArgs): null {
    seen.push(useTeamScenePainter(props).painter)
    return null
  }
  const render = async (style: GamePanelStyle, scene: TeamScenePainterArgs['scene']) =>
    act(async () => {
      root.render(<Probe style={style} scene={scene} timezone="UTC" />)
    })

  beforeEach(() => {
    seen = []
    root = createRoot(document.createElement('div'))
    vi.mocked(createPixelPainter).mockReturnValue(PIXEL)
    vi.mocked(createImagePainter).mockReturnValue(IMAGE)
    vi.mocked(loadTeamSceneArt).mockImplementation(async (style) => ({ style, images: new Map() }))
  })
  afterEach(() => {
    act(() => root.unmount())
    vi.clearAllMocks()
  })

  it('gives Pixel at once and never loads art for it', async () => {
    await render('pixel', QUEST)
    expect(seen.at(0)).toBe(PIXEL)
    expect(loadTeamSceneArt).not.toHaveBeenCalled()
  })

  it('is null while the art decodes, then gives the image painter', async () => {
    await render('figures', QUEST)
    expect(seen.at(0)).toBeNull()
    expect(seen.at(-1)).toBe(IMAGE)
    expect(vi.mocked(createImagePainter).mock.calls[0]![0].art.style).toEqual(art('figures').style)
  })

  it('falls to Pixel when an image fails to load', async () => {
    vi.mocked(loadTeamSceneArt).mockRejectedValue(new Error('broken'))
    await render('figures', QUEST)
    expect(seen.at(-1)).toBe(PIXEL)
  })

  it('does not load a native block, and draws that scene in Pixel', async () => {
    const id = 'file:mine.json'
    await render('figures', { id, extensions: [blockScene(id)] })
    expect(loadTeamSceneArt).not.toHaveBeenCalled()
    expect(seen.at(-1)).toBe(PIXEL)
  })

  it('keeps its painter across a poll that repeats the same scene', async () => {
    await render('pixel', QUEST)
    await render('pixel', { id: 'quest', extensions: [] })
    expect(createPixelPainter).toHaveBeenCalledTimes(1)
  })

  it('holds the stage rather than draw one style in the art of another', async () => {
    await render('figures', QUEST)
    expect(seen.at(-1)).toBe(IMAGE)
    vi.mocked(loadTeamSceneArt).mockImplementationOnce(() => new Promise(() => {}))
    await render('office', QUEST)
    expect(seen.at(-1)).toBeNull()
  })

  it('drops the art of a style left behind when its load ends late', async () => {
    let finish: (value: Awaited<ReturnType<typeof loadTeamSceneArt>>) => void = () => {}
    vi.mocked(loadTeamSceneArt).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve))
    )
    await render('figures', QUEST)
    await render('office', QUEST)
    await act(async () => finish(art('figures')))
    expect(vi.mocked(createImagePainter).mock.calls.at(-1)![0].art.style).toEqual(
      art('office').style
    )
  })
})
