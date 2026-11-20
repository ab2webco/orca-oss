import type { GlobalSettings } from './global-settings-types'
import {
  ORCHESTRATOR_GAME_BUILT_IN_ROSTERS,
  type GameMemberName
} from './orchestrator-game-member-names'

/** The global layer's names a paired phone reads; project layers stay desktop-only (ORCA-1304). */
export type AgentTeamsNamesSettings = {
  /** null: the lead is called Lead until a layer names it. */
  leadName: string | null
  /** null: members take the scene's roster. */
  memberNames: string[] | null
  /** The built-in scene's roster; null for a scene file, which only the desktop reads. */
  sceneRoster: string[] | null
}

/** null clears the name from the global layer. */
export type AgentTeamsNamesUpdate = { leadName?: string | null; memberNames?: string[] | null }

type NamesSource = Pick<GlobalSettings, 'orchestratorGame'>

const englishOf = (name: GameMemberName): string => (typeof name === 'string' ? name : name.en)

export function agentTeamsNamesOf(settings: NamesSource): AgentTeamsNamesSettings {
  const layer = settings.orchestratorGame
  const scene = layer?.scene ?? 'quest'
  const roster = Object.hasOwn(ORCHESTRATOR_GAME_BUILT_IN_ROSTERS, scene)
    ? ORCHESTRATOR_GAME_BUILT_IN_ROSTERS[scene as keyof typeof ORCHESTRATOR_GAME_BUILT_IN_ROSTERS]
    : null
  return {
    leadName: layer?.orchestrator?.label ?? null,
    memberNames: layer?.orchestrator?.memberNames?.map(englishOf) ?? null,
    sceneRoster: roster ? roster.map(englishOf) : null
  }
}

/** The Settings write for a phone's names, merged into the global lead layer so nothing else is lost. */
export function agentTeamsNamesPatchOf(
  current: NamesSource,
  update: AgentTeamsNamesUpdate
): Partial<NamesSource> {
  const lead = { ...current.orchestratorGame?.orchestrator }
  // Why undefined, not delete: an unset key falls through to the layer below, as a missing one does.
  if (update.leadName !== undefined) {
    lead.label = update.leadName ?? undefined
  }
  if (update.memberNames !== undefined) {
    lead.memberNames = update.memberNames ?? undefined
  }
  return { orchestratorGame: { ...current.orchestratorGame, orchestrator: lead } }
}
