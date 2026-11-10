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
  readTeamSceneArtUrl,
  useTeamSceneArtHostStore,
  type TeamSceneArtHost
} from './team-scene-art-host'
import {
  teamSceneArtOf,
  useTeamScenePainter,
  type TeamSceneStage,
  type TeamScenePainterArgs
} from './use-team-scene-painter'

vi.mock('./team-scene-art-load', () => ({ loadTeamSceneArt: vi.fn() }))
vi.mock('./team-scene-art-host', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  readTeamSceneArtUrl: vi.fn()
}))
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

const HOST: TeamSceneArtHost = {
  target: { kind: 'local' },
  caller: { worktreeId: 'wt1', terminalHandle: 'h1' }
}

describe('teamSceneArtOf', () => {
  it('draws Quest in its bundled art', () => {
    expect(teamSceneArtOf({ style: 'figures', scene: QUEST })).toMatchObject({
      drawn: 'figures',
      art: 'bundled',
      defaultArt: false
    })
    expect(teamSceneArtOf({ style: 'office', scene: QUEST }).drawn).toBe('office')
  })

  it('reads a host that named no scene as Quest, as Pixel does', () => {
    expect(teamSceneArtOf({ style: 'office', scene: { id: null, extensions: [] } })).toMatchObject({
      drawn: 'office',
      defaultArt: false
    })
  })

  it('draws Pixel when Pixel is asked for', () => {
    expect(teamSceneArtOf({ style: 'pixel', scene: QUEST }).drawn).toBe('pixel')
  })

  it("draws a scene's own art when its block covers the style", () => {
    const scene = { id: 'file:mine.json', extensions: [blockScene('file:mine.json')] }
    expect(teamSceneArtOf({ style: 'figures', scene })).toMatchObject({
      drawn: 'figures',
      art: 'scene'
    })
  })

  it('draws a scene with no art in the chosen style with the default art, never Pixel', () => {
    expect(
      teamSceneArtOf({ style: 'figures', scene: { id: 'other', extensions: [] } })
    ).toMatchObject({ drawn: 'figures', art: 'bundled', defaultArt: true })
  })

  it('draws the default art when the own art did not load, and Pixel when even that failed', () => {
    const scene = { id: 'file:mine.json', extensions: [blockScene('file:mine.json')] }
    expect(teamSceneArtOf({ style: 'figures', scene, sceneArtFailed: true })).toMatchObject({
      drawn: 'figures',
      art: 'bundled',
      defaultArt: true
    })
    expect(teamSceneArtOf({ style: 'figures', scene: QUEST, bundledArtFailed: true }).drawn).toBe(
      'pixel'
    )
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
    useTeamSceneArtHostStore.setState({ host: HOST })
    vi.mocked(readTeamSceneArtUrl).mockImplementation(async (_host, _id, src) => `data:${src}`)
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

  it("loads a scene's own art from the lead's host and draws it", async () => {
    const id = 'file:mine.json'
    await render('figures', { id, extensions: [blockScene(id)] })
    const [style, urlOf] = vi.mocked(loadTeamSceneArt).mock.calls[0]!
    expect(style).toEqual(teamSceneQuestArtOf('figures'))
    await expect(urlOf('art/sky.png')).resolves.toBe('data:art/sky.png')
    expect(readTeamSceneArtUrl).toHaveBeenCalledWith(HOST, id, 'art/sky.png')
    expect(seen.at(-1)).toBe(IMAGE)
    expect(stages.at(-1)).toMatchObject({ drawn: 'figures', art: 'scene', defaultArt: false })
  })

  it('draws the default art when the own art fails, as an older host does', async () => {
    const id = 'file:mine.json'
    vi.mocked(loadTeamSceneArt).mockRejectedValueOnce(new Error('method_not_found'))
    await render('figures', { id, extensions: [blockScene(id)] })
    expect(seen.at(-1)).toBe(IMAGE)
    expect(stages.at(-1)).toMatchObject({ drawn: 'figures', art: 'bundled', defaultArt: true })
    expect(vi.mocked(loadTeamSceneArt).mock.calls.at(-1)![1]('scene/sky.png')).toBeUndefined()
  })

  it('draws the default art at once when no host is known to read the own art from', async () => {
    useTeamSceneArtHostStore.setState({ host: null })
    const id = 'file:mine.json'
    await render('office', { id, extensions: [blockScene(id)] })
    expect(readTeamSceneArtUrl).not.toHaveBeenCalled()
    expect(stages.at(-1)).toMatchObject({ drawn: 'office', art: 'bundled', defaultArt: true })
  })

  it('draws a scene with no art in the chosen style with the default art', async () => {
    await render('office', { id: 'file:.orca/scenes/koombea.json', extensions: [] })
    expect(seen.at(-1)).toBe(IMAGE)
    expect(stages.at(-1)).toMatchObject({ drawn: 'office', art: 'bundled', defaultArt: true })
  })

  it("seats members from behind only at Orca's own Office desk", async () => {
    const backOf = () => vi.mocked(createImagePainter).mock.calls.at(-1)![0].back
    await render('office', QUEST)
    expect(backOf()).toEqual(OFFICE_BACK_SEAT)
    await render('figures', QUEST)
    expect(backOf()).toBeNull()
    const id = 'file:mine.json'
    const own = {
      id,
      pluginId: 'plugin',
      definition: { native: { office: teamSceneQuestArtOf('office') } }
    } as unknown as OrchestratorGameSceneExtension
    await render('office', { id, extensions: [own] })
    expect(stages.at(-1)).toMatchObject({ drawn: 'office', art: 'scene' })
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
