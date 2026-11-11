// @vitest-environment happy-dom

import { act, useContext } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QUEST_SCENE } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/quest'
import type { OrchestratorGameSceneExtension } from '../../../../shared/orchestrator-game-scene'
import { orchestratorGameSceneArtFiles } from '../../../../shared/orchestrator-game-scene-native'
import type { TeamLeadCard, TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { TeamPanelScene } from './TeamPanelScene'
import { TeamScenePainterContext } from './team-scene-painter-context'
import { TeamSceneLeadLineContext } from './team-scene-lead-line-context'
import type { TeamScenePainter } from './team-scene-painter'
import { loadTeamSceneArt } from './team-scene-art-load'
import type { TeamSceneArtImage, TeamSceneImageArt } from './team-scene-image-painter'
import { teamSceneQuestArtOf } from './team-scene-quest-art'
import { recordingContext } from './team-scene-recording-context'
import { useTeamSceneArtHostStore } from './team-scene-art-host'
import { useAppStore } from '@/store'

vi.mock('./team-scene-art-load', () => ({ loadTeamSceneArt: vi.fn() }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const lead: TeamLeadCard = {
  paneKey: 'pane-lead',
  terminalHandle: null,
  worktreeId: null,
  host: { kind: 'local' },
  name: 'Lead',
  agentType: 'claude',
  status: 'working',
  condition: 'working',
  since: null,
  liveAction: { kind: 'question', text: 'Merge #923?', options: [] },
  model: null,
  account: null,
  characterKey: null,
  branch: null,
  ownerAsk: null
}
const model = (scene: TeamPanelGameModel['scene']): TeamPanelGameModel => ({
  kind: 'team',
  repoId: 'repo-1',
  projectName: 'orca-oss',
  lead,
  advisor: null,
  members: [],
  metrics: { kind: 'loading' },
  xp: null,
  arcade: null,
  stopped: null,
  actions: [],
  scene,
  inbox: { kind: 'loading' },
  prs: null,
  queue: null,
  machines: null
})
// A plugin scene with no native art: it can only draw in Pixel.
const plain = {
  id: 'acme.pack/night',
  pluginId: 'acme.pack',
  definition: { ...QUEST_SCENE, id: 'acme.pack/night' }
} as unknown as OrchestratorGameSceneExtension

// A scene file with a native block, read from the lead's host.
const carrying = {
  id: 'file:mine.json',
  pluginId: 'file',
  definition: {
    ...QUEST_SCENE,
    id: 'file:mine.json',
    native: { figures: teamSceneQuestArtOf('figures') }
  }
} as unknown as OrchestratorGameSceneExtension
const decoded = (style: 'figures' | 'office'): TeamSceneImageArt => {
  const art = teamSceneQuestArtOf(style)
  const image = { width: 128, height: 128 } as unknown as TeamSceneArtImage
  return {
    style: art,
    images: new Map(orchestratorGameSceneArtFiles({ figures: art }).map((src) => [src, image]))
  }
}

let root: Root
let host: HTMLDivElement
const canvasHeight = (): string | undefined => host.querySelector('canvas')?.style.height
const shownStyle = (): string | null | undefined =>
  host.querySelector('[data-team-scene]')?.getAttribute('data-team-scene')
const artOf = (): (string | null)[] => {
  const stage = host.querySelector('[data-team-scene]')
  return [
    stage?.getAttribute('data-team-scene-art') ?? null,
    stage?.getAttribute('data-team-scene-default-art') ?? null
  ]
}
const stageHeight = (): string | undefined =>
  host.querySelector<HTMLElement>('[data-team-scene] > *')?.style.height

beforeEach(() => {
  // Why: reduced motion paints once, so the bubble is laid out with no frame loop to drive.
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: true,
        media: query,
        addEventListener() {},
        removeEventListener() {}
      }) as unknown as MediaQueryList
  )
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(120)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(30)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recordingContext().g)
  useTeamSceneArtHostStore.setState({
    host: { target: { kind: 'local' }, caller: { worktreeId: 'wt1', terminalHandle: 'h1' } }
  })
  vi.mocked(loadTeamSceneArt).mockClear()
  vi.mocked(loadTeamSceneArt).mockImplementation((style) =>
    Promise.resolve(decoded(style === teamSceneQuestArtOf('office') ? 'office' : 'figures'))
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

describe('TeamPanelScene', () => {
  // Why (ORCA-1129): game.state names only the tool, so the bubble read "AskUserQuestion".
  it("says the lead's question in its bubble, never the question tool's name", async () => {
    const asking = {
      ...model({ id: 'quest', extensions: [] }),
      lead: {
        ...lead,
        liveAction: { kind: 'tool' as const, tool: 'AskUserQuestion', detail: null }
      }
    }
    useAppStore.setState({
      agentStatusByPaneKey: {
        'pane-lead': {
          state: 'waiting',
          prompt: 'Ship it',
          updatedAt: 1,
          stateStartedAt: 1,
          paneKey: 'pane-lead',
          stateHistory: [],
          toolName: 'AskUserQuestion',
          interactivePrompt: JSON.stringify({
            questions: [{ question: 'Merge #923 now?', options: [{ label: 'Now' }] }]
          })
        }
      }
    })
    await act(async () => root.render(<TeamPanelScene model={asking} style="pixel" />))

    const bubble = host.querySelector('[data-scene-bubble="lead"]')?.textContent
    expect(bubble).toBe('Waiting for you · Merge #923 now?')

    act(() => useAppStore.setState({ agentStatusByPaneKey: {} }))
    expect(host.querySelector('[data-scene-bubble="lead"]')?.textContent).toBe('Waiting for you')
  })

  // ORCA-1139 lead review: a lead's bubble with no spot left its line nowhere.
  it("hands the lead's line to what it wraps while its bubble has no room, and nothing once it fits", async () => {
    let seen: string | null = null
    function Probe(): null {
      seen = useContext(TeamSceneLeadLineContext)
      return null
    }
    const asking = (text: string) => ({
      ...model({ id: 'quest', extensions: [] }),
      lead: { ...lead, liveAction: { kind: 'question' as const, text, options: [] } }
    })
    const show = async (text: string) => {
      await act(async () =>
        root.render(
          <TeamPanelScene model={asking(text)} style="pixel">
            <Probe />
          </TeamPanelScene>
        )
      )
      return host.querySelector<HTMLElement>('[data-scene-bubble="lead"]')!
    }

    const fits = await show('Merge #923?')
    expect(fits.style.visibility).toBe('visible')
    expect(seen).toBeNull()

    // Taller than the room over the lead's head on Pixel's 126 px stage: no spot keeps it inside.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(130)
    const crowded = await show('Merge #924 once the Windows check is green?')
    expect(crowded.style.visibility).toBe('hidden')
    expect(seen).toBe(crowded.textContent)
    expect(seen).toContain('Merge #924 once the Windows check is green?')
  })

  it('hands its painter to what it wraps, so card faces match the scene', async () => {
    let seen: TeamScenePainter | null = null
    function Probe(): null {
      seen = useContext(TeamScenePainterContext)
      return null
    }
    await act(async () =>
      root.render(
        <TeamPanelScene model={model({ id: 'quest', extensions: [] })} style="pixel">
          <Probe />
        </TeamPanelScene>
      )
    )
    expect(seen).not.toBeNull()
    expect(typeof seen!.portrait).toBe('function')
  })

  it('draws Quest in its art for the style asked for', async () => {
    await act(async () =>
      root.render(<TeamPanelScene model={model({ id: 'quest', extensions: [] })} style="figures" />)
    )
    expect(loadTeamSceneArt).toHaveBeenLastCalledWith(
      teamSceneQuestArtOf('figures'),
      expect.any(Function)
    )
    expect(canvasHeight()).toBe('176px')
    expect(shownStyle()).toBe('figures')
    await act(async () =>
      root.render(<TeamPanelScene model={model({ id: 'quest', extensions: [] })} style="office" />)
    )
    expect(loadTeamSceneArt).toHaveBeenLastCalledWith(
      teamSceneQuestArtOf('office'),
      expect.any(Function)
    )
    expect(canvasHeight()).toBe('176px')
    expect(shownStyle()).toBe('office')
  })

  it('holds the stage at its height while the art decodes, so the panel does not jump', async () => {
    let finish = (_art: TeamSceneImageArt): void => {}
    vi.mocked(loadTeamSceneArt).mockReturnValue(new Promise((resolve) => (finish = resolve)))
    act(() =>
      root.render(<TeamPanelScene model={model({ id: 'quest', extensions: [] })} style="figures" />)
    )
    expect(host.querySelector('canvas')).toBeNull()
    expect(stageHeight()).toBe('176px')
    await act(async () => finish(decoded('figures')))
    expect(canvasHeight()).toBe('176px')
  })

  it('falls to Pixel when the art fails to load, and says so', async () => {
    vi.mocked(loadTeamSceneArt).mockRejectedValue(new Error('broken'))
    await act(async () =>
      root.render(<TeamPanelScene model={model({ id: 'quest', extensions: [] })} style="office" />)
    )
    expect(canvasHeight()).toBe('126px')
    expect(shownStyle()).toBe('pixel')
  })

  it("draws a scene file's own art, read from the lead's host", async () => {
    await act(async () =>
      root.render(
        <TeamPanelScene
          model={model({ id: carrying.id, extensions: [carrying] })}
          style="figures"
        />
      )
    )
    expect(shownStyle()).toBe('figures')
    expect(artOf()).toEqual(['scene', null])
    expect(loadTeamSceneArt).toHaveBeenLastCalledWith(
      teamSceneQuestArtOf('figures'),
      expect.any(Function)
    )
  })

  it('draws a scene with no art for the style with the default art, and marks it', async () => {
    await act(async () =>
      root.render(
        <TeamPanelScene model={model({ id: plain.id, extensions: [plain] })} style="office" />
      )
    )
    expect(shownStyle()).toBe('office')
    expect(artOf()).toEqual(['bundled', 'true'])
  })

  it('draws Quest exported as a scene file with its bundled art, not marked as default', async () => {
    const id = 'file:.orca/scenes/quest.json'
    const file = { ...plain, id, pluginId: 'file' } as OrchestratorGameSceneExtension
    await act(async () =>
      root.render(<TeamPanelScene model={model({ id, extensions: [file] })} style="figures" />)
    )
    expect(shownStyle()).toBe('figures')
    expect(artOf()).toEqual(['bundled', null])
  })

  it('draws Pixel when asked, and the lead line from the model', () => {
    act(() =>
      root.render(<TeamPanelScene model={model({ id: null, extensions: [] })} style="pixel" />)
    )
    expect(canvasHeight()).toBe('126px')
    expect(host.querySelector('[data-scene-bubble="lead"]')?.textContent).toContain('Merge #923?')
  })
})
