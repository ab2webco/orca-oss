import type { GlobalSettings } from './global-settings-types'
import { DEFAULT_ORCHESTRATOR_GAME_CONFIG } from './orchestrator-game-config'
import {
  resolveGamePanel,
  withGamePanelField,
  type GamePanelLook,
  type GamePanelStyle
} from './orchestrator-game-panel'
import {
  normalizeStatusColorOverrides,
  type StatusColorOverrides,
  type StatusColorPalette,
  type StatusColorTheme
} from './status-colors'

/** The global Agent Teams panel a paired phone reads; per-project layers stay desktop-only. */
export type AgentTeamsPanelSettings = {
  scene: string
  look: GamePanelLook
  style: GamePanelStyle
}

export type AgentTeamsClientSettings = {
  agentTeamsPanel: AgentTeamsPanelSettings
  statusColors: StatusColorOverrides
}

/** What a paired phone may change; a null palette resets that theme to the defaults. */
export type AgentTeamsSettingsUpdate = {
  agentTeamsPanel?: { scene?: string; style?: GamePanelStyle }
  statusColors?: Partial<Record<StatusColorTheme, StatusColorPalette | null>>
}

type AgentTeamsSettingsSource = Pick<GlobalSettings, 'orchestratorGame' | 'statusColors'>

export function agentTeamsClientSettingsOf(
  settings: AgentTeamsSettingsSource
): AgentTeamsClientSettings {
  const layer = settings.orchestratorGame
  const { look, style } = resolveGamePanel([layer?.panel], {
    mode: layer?.mode ?? DEFAULT_ORCHESTRATOR_GAME_CONFIG.mode,
    render: layer?.render ?? DEFAULT_ORCHESTRATOR_GAME_CONFIG.render
  })
  return {
    agentTeamsPanel: { scene: layer?.scene ?? DEFAULT_ORCHESTRATOR_GAME_CONFIG.scene, look, style },
    statusColors: normalizeStatusColorOverrides(settings.statusColors)
  }
}

/** The Settings write for a phone's update, merged into the current values so nothing else is lost. */
export function agentTeamsSettingsPatchOf(
  current: AgentTeamsSettingsSource,
  update: AgentTeamsSettingsUpdate
): Partial<AgentTeamsSettingsSource> {
  const patch: Partial<AgentTeamsSettingsSource> = {}
  const panel = update.agentTeamsPanel
  if (panel) {
    let layer = { ...current.orchestratorGame }
    if (panel.scene !== undefined) {
      layer.scene = panel.scene
    }
    if (panel.style !== undefined) {
      layer = withGamePanelField(layer, 'style', panel.style)
    }
    patch.orchestratorGame = layer
  }
  if (update.statusColors) {
    const next: Record<string, unknown> = { ...current.statusColors }
    for (const [theme, palette] of Object.entries(update.statusColors)) {
      next[theme] = palette ?? undefined
    }
    patch.statusColors = normalizeStatusColorOverrides(next)
  }
  return patch
}
