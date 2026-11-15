import { GAME_PANEL_STYLES, type GamePanelStyle } from '../../../src/shared/orchestrator-game-panel'
import {
  orchestratorGameSceneArtOf,
  orchestratorGameSceneNativeOf,
  type OrchestratorGameSceneNativeStyle
} from '../../../src/shared/orchestrator-game-scene-native'
import type { TeamLeadCard, TeamMemberCard } from '../../../src/shared/team-panel-model-types'

export type TeamSceneBandActor = {
  key: string
  role: 'lead' | 'member' | 'advisor'
  /** Picks which of the role's sheets it wears, modulo how many the art has. */
  seed: number
}

type BandFallback =
  | { kind: 'art'; style: 'figures' | 'office'; actors: TeamSceneBandActor[] }
  | { kind: 'readable'; actors: TeamSceneBandActor[] }

/** `art` is Orca's own Quest art, `scene` the scene file's art read from the host, `readable` names only. */
export type TeamSceneBand =
  | BandFallback
  | {
      kind: 'scene'
      style: 'figures' | 'office'
      sceneId: string
      native: OrchestratorGameSceneNativeStyle
      actors: TeamSceneBandActor[]
      /** Drawn when the scene's images do not load. */
      fallback: BandFallback
    }

const QUEST = 'quest'
// Why: past eight the figures overlap at 320 pt; the Team tab still lists every member.
const MEMBERS_DRAWN = 8

type Rec = Record<string, unknown>
const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Why FNV-1a: the desktop's figureSeedOf, so a member wears the same sheet on both.
function figureSeedOf(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  }
  return h >>> 0
}

const styleOf = (panel: Rec): GamePanelStyle =>
  GAME_PANEL_STYLES.find((one) => one === panel.style) ?? 'pixel'

/**
 * The band above the tabs, chosen as the desktop's Game look chooses its stage; null when the
 * desktop panel shows no scene. Pixel draws as `readable` until the phone has a Pixel painter.
 */
export function teamSceneBandOf(
  state: Rec,
  cards: { lead: TeamLeadCard | null; members: readonly TeamMemberCard[]; advisor: boolean },
  /** `sceneArt`: the host advertises mobile.team-scene.v1, so a scene file's own art can be read. */
  options: { sceneArt?: boolean } = {}
): TeamSceneBand | null {
  const panel = isRecord(state.panel) ? state.panel : null
  if (panel && panel.look !== 'game') {
    return null
  }
  const actors: TeamSceneBandActor[] = [
    ...(cards.lead ? [{ key: 'lead', role: 'lead' as const, seed: 0 }] : []),
    ...cards.members.slice(0, MEMBERS_DRAWN).map((card) => ({
      key: card.paneKey,
      role: 'member' as const,
      seed: figureSeedOf(card.characterKey ?? card.paneKey)
    })),
    ...(cards.advisor ? [{ key: 'advisor', role: 'advisor' as const, seed: 0 }] : [])
  ]
  if (!panel) {
    return { kind: 'readable', actors }
  }
  const config = isRecord(state.config) ? state.config : {}
  const sceneId = typeof config.scene === 'string' ? config.scene : QUEST
  const style = styleOf(panel)
  const fallback = fallbackOf(style, sceneId, actors)
  const native = options.sceneArt ? sceneNativeOf(state, sceneId) : undefined
  const own = orchestratorGameSceneArtOf({ style, sceneId, scene: native ? { native } : undefined })
  const drawn = own.drawn === 'figures' || own.drawn === 'office' ? own.drawn : null
  const art = drawn && native?.[drawn]
  return own.art === 'scene' && drawn && art
    ? { kind: 'scene', style: drawn, sceneId, native: art, actors, fallback }
    : fallback
}

// Why parsed again: a paired host may run another build, and a bad block only costs the art.
function sceneNativeOf(state: Rec, sceneId: string) {
  const scenes =
    isRecord(state.extensions) && Array.isArray(state.extensions.scenes)
      ? state.extensions.scenes
      : []
  const scene = scenes.find((one) => isRecord(one) && one.id === sceneId)
  return isRecord(scene) ? orchestratorGameSceneNativeOf(scene.definition).native : undefined
}

function fallbackOf(
  style: GamePanelStyle,
  sceneId: string,
  actors: TeamSceneBandActor[]
): BandFallback {
  const art = orchestratorGameSceneArtOf({ style, sceneId, sceneArtFailed: true })
  return art.art === 'bundled' && (art.drawn === 'figures' || art.drawn === 'office')
    ? { kind: 'art', style: art.drawn, actors }
    : { kind: 'readable', actors }
}
