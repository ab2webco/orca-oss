// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GamePanelStyle } from '../../../../shared/orchestrator-game-panel'
import type { OrchestratorGameSceneExtension } from '../../../../shared/orchestrator-game-scene'
import { loadTeamSceneArt } from './team-scene-art-load'
import { createImagePainter } from './team-scene-image-painter'
import { OFFICE_BACK_SEAT } from './team-scene-office-back'
import { createPixelPainter } from './team-scene-pixel-painter'
import type { TeamScenePainter } from './team-scene-painter'
import { teamSceneQuestArtOf } from './team-scene-quest-art'
import {
  teamSceneArtOf,
  useTeamScenePainter,
  type TeamSceneStage,
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

describe('teamSceneArtOf', () => {
  it("draws Figures and Office in Orca's art and Pixel when Pixel is asked for", () => {
    expect(teamSceneArtOf({ style: 'figures' })).toEqual({ drawn: 'figures', art: 'bundled' })
    expect(teamSceneArtOf({ style: 'office' })).toEqual({ drawn: 'office', art: 'bundled' })
    expect(teamSceneArtOf({ style: 'pixel' }).drawn).toBe('pixel')
  })

  it("falls to Pixel only when Orca's own art failed", () => {
    expect(teamSceneArtOf({ style: 'figures', bundledArtFailed: true }).drawn).toBe('pixel')
  })
})

describe('useTeamScenePainter', () => {
  const PIXEL = { height: 1 } as TeamScenePainter
  const IMAGE = { height: 2 } as TeamScenePainter
  let root: Root
  let seen: (TeamScenePainter | null)[]
  let stages: TeamSceneStage[]

  function Probe(props: TeamScenePainterArgs): null {
    const stage = useTeamScenePainter(props)
    stages.push(stage)
    seen.push(stage.painter)
    return null
  }
  const render = async (style: GamePanelStyle, scene: TeamScenePainterArgs['scene']) =>
    act(async () => {
      root.render(<Probe style={style} scene={scene} timezone="UTC" />)
    })

  beforeEach(() => {
    seen = []
    stages = []
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

  it('falls to Pixel only when the bundled art fails to load', async () => {
    vi.mocked(loadTeamSceneArt).mockRejectedValue(new Error('broken'))
    await render('figures', QUEST)
    expect(seen.at(-1)).toBe(PIXEL)
    expect(stages.at(-1)?.drawn).toBe('pixel')
  })

  // ORCA-1296: a themed scene, with or without art of its own, draws Orca's Figures and Office.
  it.each(['figures', 'office'] as const)("draws %s in Orca's art for any scene", async (style) => {
    for (const scene of [
      { id: 'file:mine.json', extensions: [blockScene('file:mine.json')] },
      { id: 'file:.orca/scenes/koombea.json', extensions: [] },
      { id: 'vigilante', extensions: [] }
    ]) {
      await render(style, scene)
      expect(seen.at(-1)).toBe(IMAGE)
      expect(stages.at(-1)).toMatchObject({ drawn: style, art: 'bundled' })
    }
    for (const [loaded] of vi.mocked(loadTeamSceneArt).mock.calls) {
      expect(loaded).toEqual(teamSceneQuestArtOf(style))
    }
  })

  it('seats members from behind at the Office desk, not in Figures', async () => {
    const backOf = () => vi.mocked(createImagePainter).mock.calls.at(-1)![0].back
    await render('office', QUEST)
    expect(backOf()).toEqual(OFFICE_BACK_SEAT)
    await render('figures', QUEST)
    expect(backOf()).toBeNull()
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
