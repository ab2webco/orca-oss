import type { OrchestratorGameConfig } from './orchestrator-game-config'

export const GAME_PANEL_LOOKS = ['game', 'display', 'plain'] as const
export const GAME_PANEL_STYLES = ['figures', 'office', 'pixel'] as const
export const GAME_PANEL_TABS = ['prs', 'queue', 'machines'] as const

export type GamePanelLook = (typeof GAME_PANEL_LOOKS)[number]
export type GamePanelStyle = (typeof GAME_PANEL_STYLES)[number]
export type GamePanelTab = (typeof GAME_PANEL_TABS)[number]

/** The native panel's own keys; `mode` and `render` keep driving the terminal beside them. */
export type OrchestratorGamePanel = {
  look: GamePanelLook
  style: GamePanelStyle
  tabs: Record<GamePanelTab, boolean>
  /** The Advisor row; drawn only when its plugin is installed. */
  advisor: boolean
  /** Saved arcade credits; drawn only in the Game look. */
  arcade: boolean
}

export type OrchestratorGamePanelLayer = Partial<Omit<OrchestratorGamePanel, 'tabs'>> & {
  tabs?: Partial<Record<GamePanelTab, boolean>>
}

export type GamePanelField = Exclude<keyof OrchestratorGamePanel, 'tabs'> | GamePanelTab

export type GamePanelValue = boolean | GamePanelLook | GamePanelStyle

const at = (key: string): string => `orchestratorGame.panel.${key}`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const oneOf =
  <T extends string>(list: readonly T[]) =>
  (value: unknown): value is T =>
    (list as readonly unknown[]).includes(value)

const isLook = oneOf(GAME_PANEL_LOOKS)
const isStyle = oneOf(GAME_PANEL_STYLES)
const isTab = oneOf(GAME_PANEL_TABS)

const orList = (list: readonly string[]): string =>
  `${list.slice(0, -1).join(', ')} or ${list.at(-1)}`

function parseTabs(raw: unknown): {
  value: Partial<Record<GamePanelTab, boolean>> | undefined
  warnings: string[]
} {
  if (!isRecord(raw)) {
    return { value: undefined, warnings: [`${at('tabs')} must be a mapping`] }
  }
  const value: Partial<Record<GamePanelTab, boolean>> = {}
  const warnings: string[] = []
  for (const [key, entry] of Object.entries(raw)) {
    if (!isTab(key)) {
      warnings.push(`${at(`tabs.${key}`)} is not a tab that can be hidden`)
    } else if (typeof entry === 'boolean') {
      value[key] = entry
    } else {
      warnings.push(`${at(`tabs.${key}`)} must be true or false`)
    }
  }
  return { value, warnings }
}

/** A layer's `panel` block; a bad value is dropped with its warning so the layer below shows. */
export function parseGamePanel(raw: unknown): {
  value: OrchestratorGamePanelLayer | undefined
  warnings: string[]
} {
  if (!isRecord(raw)) {
    return {
      value: undefined,
      warnings: ['orchestratorGame.panel must be a mapping']
    }
  }
  const value: OrchestratorGamePanelLayer = {}
  const warnings: string[] = []
  for (const [key, entry] of Object.entries(raw)) {
    if (key === 'look') {
      if (isLook(entry)) {
        value.look = entry
      } else {
        warnings.push(`${at(key)} must be ${orList(GAME_PANEL_LOOKS)}`)
      }
    } else if (key === 'style') {
      // Why: Soft was selectable before anything drew it; a saved one keeps drawing in Pixel.
      const style = entry === 'soft' ? 'pixel' : entry
      if (isStyle(style)) {
        value.style = style
      } else {
        warnings.push(`${at(key)} must be ${orList(GAME_PANEL_STYLES)}`)
      }
    } else if (key === 'tabs') {
      const tabs = parseTabs(entry)
      warnings.push(...tabs.warnings)
      if (tabs.value) {
        value.tabs = tabs.value
      }
    } else if (key === 'advisor' || key === 'arcade') {
      if (typeof entry === 'boolean') {
        value[key] = entry
      } else {
        warnings.push(`${at(key)} must be true or false`)
      }
    } else {
      warnings.push(`${at(key)} is not a known setting`)
    }
  }
  return { value, warnings }
}

// Why one function: the legacy-to-look mapping and the fresh-install default are still open decisions.
export function gamePanelLookOfLegacy(
  legacy: Pick<OrchestratorGameConfig, 'mode' | 'render'>
): Pick<OrchestratorGamePanel, 'look' | 'style'> {
  const look: GamePanelLook =
    legacy.mode === 'zen' ? 'display' : legacy.mode === 'flat' ? 'plain' : 'game'
  return { look, style: 'pixel' }
}

// Why key by key: orca.yaml can hide Queue while this machine picks its own look.
export function resolveGamePanel(
  layers: readonly (OrchestratorGamePanelLayer | undefined)[],
  legacy: Pick<OrchestratorGameConfig, 'mode' | 'render'>
): OrchestratorGamePanel {
  const panel: OrchestratorGamePanel = {
    ...gamePanelLookOfLegacy(legacy),
    tabs: { prs: true, queue: true, machines: true },
    advisor: true,
    arcade: true
  }
  for (const layer of layers) {
    // Why re-parsed: a Settings layer is hand-editable JSON that never went through the parser.
    const { tabs, ...rest } = (layer && parseGamePanel(layer).value) ?? {}
    Object.assign(panel, rest)
    Object.assign(panel.tabs, tabs)
  }
  return panel
}

/** Sets one panel key or tab on a layer; `undefined` removes it, and the empty block with it. */
export function withGamePanelField<L extends { panel?: OrchestratorGamePanelLayer }>(
  layer: L | undefined,
  field: GamePanelField,
  value: GamePanelValue | undefined
): L {
  const panel: OrchestratorGamePanelLayer = { ...layer?.panel }
  if (isTab(field)) {
    const tabs = { ...panel.tabs }
    if (value === undefined) {
      delete tabs[field]
    } else {
      tabs[field] = value as boolean
    }
    panel.tabs = tabs
    if (Object.keys(tabs).length === 0) {
      delete panel.tabs
    }
  } else if (value === undefined) {
    delete panel[field]
  } else {
    Object.assign(panel, { [field]: value })
  }
  const next = { ...layer } as L
  if (Object.keys(panel).length === 0) {
    delete next.panel
  } else {
    next.panel = panel
  }
  return next
}
