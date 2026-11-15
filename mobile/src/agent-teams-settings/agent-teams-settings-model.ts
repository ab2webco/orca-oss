import { GAME_PANEL_STYLES, type GamePanelStyle } from '../../../src/shared/orchestrator-game-panel'

/** The host's global Agent Teams panel. */
export type AgentTeamsSettings = { scene: string; style: GamePanelStyle }

// Why these labels: the desktop's scene select names them so (OrchestratorGameSceneSelect).
export const BUILT_IN_SCENES = [
  { id: 'quest', label: 'Quest' },
  { id: 'vigilante', label: 'Night Watch' },
  { id: 'jrpg', label: 'Crystal Saga' },
  { id: 'tamer', label: 'Beast Tamer' }
] as const

export const PANEL_STYLES: readonly { id: GamePanelStyle; label: string }[] = [
  { id: 'pixel', label: 'Pixel' },
  { id: 'office', label: 'Office' },
  { id: 'figures', label: 'Figures' }
]

const recordOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const isStyle = (value: unknown): value is GamePanelStyle =>
  (GAME_PANEL_STYLES as readonly unknown[]).includes(value)

/** null from a host that sends no Agent Teams fields in settings.get (they sit under `settings`). */
export function agentTeamsSettingsOf(result: unknown): AgentTeamsSettings | null {
  const panel = recordOf(recordOf(recordOf(result)?.settings)?.agentTeamsPanel)
  if (!panel || typeof panel.scene !== 'string') {
    return null
  }
  return { scene: panel.scene, style: isStyle(panel.style) ? panel.style : 'pixel' }
}

export function sceneLabelOf(scene: string): string {
  const builtIn = BUILT_IN_SCENES.find((one) => one.id === scene)
  return builtIn ? builtIn.label : (scene.split(/[\\/]/).pop() ?? scene)
}
