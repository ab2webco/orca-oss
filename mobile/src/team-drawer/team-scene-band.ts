import { GAME_PANEL_STYLES, type GamePanelStyle } from '../../../src/shared/orchestrator-game-panel'
import { orchestratorGameSceneArtOf } from '../../../src/shared/orchestrator-game-scene-native'
import type { TeamLeadCard, TeamMemberCard } from '../../../src/shared/team-panel-model-types'

export type TeamSceneBandActor = {
  key: string
  role: 'lead' | 'member' | 'advisor'
  /** Which of the role's sheets it wears. */
  sheet: number
}

/** `readable` is the band with no art: names in place of figures. */
export type TeamSceneBand =
  | { kind: 'art'; style: 'figures' | 'office'; actors: TeamSceneBandActor[] }
  | { kind: 'readable'; actors: TeamSceneBandActor[] }

const QUEST = 'quest'
const MEMBER_SHEETS = 8
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
 * The band above the tabs, drawn as the desktop's Game look draws its stage; null when the
 * desktop panel shows no scene. Pixel and a scene's own art come later; both read as `readable`.
 */
export function teamSceneBandOf(
  state: Rec,
  cards: { lead: TeamLeadCard | null; members: readonly TeamMemberCard[]; advisor: boolean }
): TeamSceneBand | null {
  const panel = isRecord(state.panel) ? state.panel : null
  if (panel && panel.look !== 'game') {
    return null
  }
  const actors: TeamSceneBandActor[] = [
    ...(cards.lead ? [{ key: 'lead', role: 'lead' as const, sheet: 0 }] : []),
    ...cards.members.slice(0, MEMBERS_DRAWN).map((card) => ({
      key: card.paneKey,
      role: 'member' as const,
      sheet: figureSeedOf(card.characterKey ?? card.paneKey) % MEMBER_SHEETS
    })),
    ...(cards.advisor ? [{ key: 'advisor', role: 'advisor' as const, sheet: 0 }] : [])
  ]
  if (!panel) {
    return { kind: 'readable', actors }
  }
  const config = isRecord(state.config) ? state.config : {}
  const art = orchestratorGameSceneArtOf({
    style: styleOf(panel),
    sceneId: typeof config.scene === 'string' ? config.scene : QUEST,
    // Why failed: the phone does not read a scene file's own images yet, so Orca's art or Pixel draws.
    sceneArtFailed: true
  })
  return art.art === 'bundled' && (art.drawn === 'figures' || art.drawn === 'office')
    ? { kind: 'art', style: art.drawn, actors }
    : { kind: 'readable', actors }
}
