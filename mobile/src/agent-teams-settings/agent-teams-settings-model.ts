import { GAME_PANEL_STYLES, type GamePanelStyle } from '../../../src/shared/orchestrator-game-panel'
import {
  normalizeStatusColorOverrides,
  STATUS_COLOR_BACKGROUND,
  STATUS_COLOR_DEFAULTS,
  STATUS_COLOR_TONES,
  statusColorWarning,
  type StatusColorPalette,
  type StatusColorTone
} from '../../../src/shared/status-colors'

/** The host's global Agent Teams panel and the dark status colours (the phone is dark-only). */
export type AgentTeamsSettings = { scene: string; style: GamePanelStyle; dark: StatusColorPalette }

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

const TONE_NAMES: Record<StatusColorTone, string> = {
  attention: 'Needs you',
  warning: 'At risk',
  info: 'Working',
  success: 'Verified',
  idle: 'Idle'
}

const recordOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const isStyle = (value: unknown): value is GamePanelStyle =>
  (GAME_PANEL_STYLES as readonly unknown[]).includes(value)

/** null from a host that sends no Agent Teams fields in settings.get (they sit under `settings`). */
export function agentTeamsSettingsOf(result: unknown): AgentTeamsSettings | null {
  const settings = recordOf(recordOf(result)?.settings)
  const panel = recordOf(settings?.agentTeamsPanel)
  if (!panel || typeof panel.scene !== 'string') {
    return null
  }
  return {
    scene: panel.scene,
    style: isStyle(panel.style) ? panel.style : 'pixel',
    dark: normalizeStatusColorOverrides(settings?.statusColors).dark ?? {}
  }
}

export function sceneLabelOf(scene: string): string {
  const builtIn = BUILT_IN_SCENES.find((one) => one.id === scene)
  return builtIn ? builtIn.label : (scene.split(/[\\/]/).pop() ?? scene)
}

export type StatusColorRow = {
  tone: StatusColorTone
  name: string
  color: string
  edited: boolean
  warning: string | null
}

/** The five roles on the dark palette, with the desktop's shared Too close / Low contrast checks. */
export function statusColorRowsOf(dark: StatusColorPalette): StatusColorRow[] {
  const palette = { ...STATUS_COLOR_DEFAULTS.dark, ...dark }
  return STATUS_COLOR_TONES.map((tone) => {
    const warning = statusColorWarning(tone, palette, STATUS_COLOR_BACKGROUND.dark)
    return {
      tone,
      name: TONE_NAMES[tone],
      color: palette[tone],
      edited: dark[tone] !== undefined,
      warning: !warning
        ? null
        : warning.kind === 'close'
          ? `Too close to ${TONE_NAMES[warning.other]}`
          : 'Low contrast'
    }
  })
}

/** null clears the role back to its default. */
export function withToneColor(
  dark: StatusColorPalette,
  tone: StatusColorTone,
  color: string | null
): StatusColorPalette {
  const next = { ...dark }
  if (color === null) {
    delete next[tone]
  } else {
    next[tone] = color.toLowerCase()
  }
  return next
}

export function statusColorsUpdateOf(dark: StatusColorPalette): {
  statusColors: { dark: StatusColorPalette | null }
} {
  return { statusColors: { dark: Object.keys(dark).length > 0 ? dark : null } }
}

/** Each default hue of both themes once, for the role sheet's grid. */
export const STATUS_COLOR_SWATCHES: readonly string[] = [
  ...new Set(
    STATUS_COLOR_TONES.flatMap((tone) => [
      STATUS_COLOR_DEFAULTS.dark[tone],
      STATUS_COLOR_DEFAULTS.light[tone]
    ])
  )
]
