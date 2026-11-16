import { GAME_PANEL_STYLES, type GamePanelStyle } from '../../../src/shared/orchestrator-game-panel'
import type { OrchestratorGameSceneExtension } from '../../../src/shared/orchestrator-game-scene'
import {
  orchestratorGameSceneArtOf,
  orchestratorGameSceneNativeOf,
  type OrchestratorGameSceneNativeStyle
} from '../../../src/shared/orchestrator-game-scene-native'
import type {
  TeamAdvisorRow,
  TeamLeadCard,
  TeamMemberCard
} from '../../../src/shared/team-panel-model-types'
import { teamSceneInputOf } from '../../../src/shared/team-scene/team-scene-input'
import type { TeamSceneInput } from '../../../src/shared/team-scene/team-scene-types'

/** Where the stage's art comes from: Orca's Quest art, the scene file's own, or Pixel's sprites. */
export type TeamSceneArtPick =
  | { kind: 'bundled'; style: 'figures' | 'office' }
  | {
      kind: 'scene'
      style: 'figures' | 'office'
      sceneId: string
      native: OrchestratorGameSceneNativeStyle
    }
  | { kind: 'pixel'; sceneId: string }

/** `stage` is the desktop's live scene; `readable` names only, for a host that sends no panel. */
export type TeamSceneBand =
  | { kind: 'readable' }
  | {
      kind: 'stage'
      art: TeamSceneArtPick
      /** Drawn when the scene file's images do not load. */
      fallback: TeamSceneArtPick
      /** The host's scene files, which Pixel draws its themes from. */
      scenes: OrchestratorGameSceneExtension[]
      timezone: string
      /** What the desktop's scene director reads: who is on stage and what each one does. */
      input: TeamSceneInput
    }

const QUEST = 'quest'

type Rec = Record<string, unknown>
const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const styleOf = (panel: Rec): GamePanelStyle =>
  GAME_PANEL_STYLES.find((one) => one === panel.style) ?? 'pixel'

/** The band above the tabs, chosen as the desktop's Game look chooses its stage; null when it shows none. */
export function teamSceneBandOf(
  state: Rec,
  cards: {
    lead: TeamLeadCard | null
    members: readonly TeamMemberCard[]
    advisor: TeamAdvisorRow | null
    stopped: boolean
  },
  /** `sceneArt`: the host advertises mobile.team-scene.v1, so a scene file's own art can be read. */
  options: { sceneArt?: boolean } = {}
): TeamSceneBand | null {
  const panel = isRecord(state.panel) ? state.panel : null
  if (panel && panel.look !== 'game') {
    return null
  }
  if (!panel || !cards.lead) {
    return { kind: 'readable' }
  }
  const config = isRecord(state.config) ? state.config : {}
  const sceneId = typeof config.scene === 'string' ? config.scene : QUEST
  const style = styleOf(panel)
  const scenes = scenesOf(state)
  const native = options.sceneArt ? sceneNativeOf(scenes, sceneId) : undefined
  const fallback = pickOf(
    orchestratorGameSceneArtOf({ style, sceneId, sceneArtFailed: true }),
    sceneId,
    undefined
  )
  const art = pickOf(
    orchestratorGameSceneArtOf({ style, sceneId, scene: native ? { native } : undefined }),
    sceneId,
    native
  )
  return {
    kind: 'stage',
    art,
    fallback,
    scenes,
    timezone: typeof config.timezone === 'string' ? config.timezone : 'local',
    input: teamSceneInputOf({
      lead: cards.lead,
      advisor: cards.advisor,
      members: [...cards.members],
      // Why no detail: the director only draws whether the STOP is set.
      stopped: cards.stopped ? { since: null, by: null } : null
    })
  }
}

function pickOf(
  own: ReturnType<typeof orchestratorGameSceneArtOf>,
  sceneId: string,
  native: ReturnType<typeof orchestratorGameSceneNativeOf>['native'] | undefined
): TeamSceneArtPick {
  const drawn = own.drawn === 'figures' || own.drawn === 'office' ? own.drawn : null
  const art = drawn && native?.[drawn]
  if (drawn && own.art === 'scene' && art) {
    return { kind: 'scene', style: drawn, sceneId, native: art }
  }
  return drawn && own.art === 'bundled'
    ? { kind: 'bundled', style: drawn }
    : { kind: 'pixel', sceneId }
}

// Why parsed again: a paired host may run another build, and a bad block only costs the art.
function scenesOf(state: Rec): OrchestratorGameSceneExtension[] {
  const scenes =
    isRecord(state.extensions) && Array.isArray(state.extensions.scenes)
      ? state.extensions.scenes
      : []
  return scenes.filter(
    (one): one is OrchestratorGameSceneExtension => isRecord(one) && typeof one.id === 'string'
  )
}

function sceneNativeOf(scenes: readonly OrchestratorGameSceneExtension[], sceneId: string) {
  const scene = scenes.find((one) => one.id === sceneId)
  return scene ? orchestratorGameSceneNativeOf(scene.definition).native : undefined
}

/**
 * Whether the open sheet, scrolled `scrollY` down, still shows any of the scene band, whose bottom
 * edge sits `bandBottom` down its content; unknown until the band is laid out. The band leads the
 * content, so scrolling past its bottom is the only way it leaves the view.
 */
export function teamSceneBandShown(scrollY: number, bandBottom: number | null): boolean {
  'worklet'
  return bandBottom === null || scrollY < bandBottom
}
