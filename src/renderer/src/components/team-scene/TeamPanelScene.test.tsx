// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QUEST_SCENE } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/quest'
import type { OrchestratorGameSceneExtension } from '../../../../shared/orchestrator-game-scene'
import type { TeamLeadCard, TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { TeamPanelScene } from './TeamPanelScene'
import { recordingContext } from './team-scene-recording-context'

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
  branch: null
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

let root: Root
let host: HTMLDivElement
const canvasHeight = (): string | undefined => host.querySelector('canvas')?.style.height

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
  it('draws Quest in the style asked for, since Quest has art for it', () => {
    act(() =>
      root.render(<TeamPanelScene model={model({ id: 'quest', extensions: [] })} style="figures" />)
    )
    expect(canvasHeight()).toBe('176px')
    act(() =>
      root.render(<TeamPanelScene model={model({ id: 'quest', extensions: [] })} style="office" />)
    )
    expect(canvasHeight()).toBe('176px')
  })

  it('draws a scene with no native art in Pixel, with the game cloud', () => {
    act(() =>
      root.render(
        <TeamPanelScene model={model({ id: plain.id, extensions: [plain] })} style="figures" />
      )
    )
    expect(canvasHeight()).toBe('126px')
    expect(host.querySelector('[data-scene-bubble="lead"] canvas')).not.toBeNull()
  })

  it('draws Pixel when asked, and the lead line from the model', () => {
    act(() =>
      root.render(<TeamPanelScene model={model({ id: null, extensions: [] })} style="pixel" />)
    )
    expect(canvasHeight()).toBe('126px')
    expect(host.querySelector('[data-scene-bubble="lead"]')?.textContent).toContain('Merge #923?')
  })
})
