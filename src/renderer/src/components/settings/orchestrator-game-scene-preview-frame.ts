import {
  gameLocaleOf,
  localizedNameOf,
  setGameLocale
} from '../../../../../resources/claude-plugins/orca-game/hooks/game-strings'
import { UPPER_HALF } from '../../../../../resources/claude-plugins/orca-game/hooks/pixel-canvas'
import {
  SCENE_ROWS,
  SCENE_TICK_MS,
  sceneGridOf
} from '../../../../../resources/claude-plugins/orca-game/hooks/scene'
import {
  DEFAULT_SCENE_ID,
  SCENES,
  type SceneDefinition,
  type ScenePhase
} from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/index'
import type { OrchestratorGameSceneOption } from './orchestrator-game-scene-options'

// Why the mod's own modules: the preview must stay the art Agent Teams panes draw, not a copy.

export const PREVIEW_COLUMNS = 64
export const PREVIEW_TICK_MS = SCENE_TICK_MS
// About three seconds per phase at the mod's tick.
export const PREVIEW_PHASE_TICKS = 25

const PHASES: readonly ScenePhase[] = ['working', 'docs', 'build', 'verify', 'pr', 'handoff']

export type ScenePreviewFrame = {
  columns: number
  rows: number
  cells: readonly (readonly number[])[]
  phase: ScenePhase
  caption: string
}

export type ScenePreviewPixels = {
  width: number
  height: number
  colors: string[]
  glyphs: { column: number; row: number; text: string; color: string }[]
}

/** Plugin scene definitions live in the main process, so the renderer has none to draw. */
export function previewSceneOf(option: OrchestratorGameSceneOption): SceneDefinition | null {
  if (option.kind === 'plugin') {
    return null
  }
  const id = option.kind === 'built-in' ? option.scene : DEFAULT_SCENE_ID
  return SCENES[id] ?? null
}

export function scenePreviewFrameOf(
  scene: SceneDefinition,
  tick: number,
  locale: string
): ScenePreviewFrame {
  const gameLocale = gameLocaleOf(locale)
  // Why: the thought bubble reads the mod's active locale, as ORCA_GAME_LOCALE sets it in a pane.
  setGameLocale(gameLocale)
  const phase = PHASES[Math.floor(tick / PREVIEW_PHASE_TICKS) % PHASES.length] ?? 'working'
  const card = scene.cards[phase]
  return {
    columns: PREVIEW_COLUMNS,
    rows: SCENE_ROWS,
    cells: sceneGridOf(scene, phase === 'working' ? undefined : phase, PREVIEW_COLUMNS, tick),
    phase,
    caption: `${card.icon} ${localizedNameOf(card.name, gameLocale)}`
  }
}

const hexOf = (color: number | undefined): string =>
  `#${(color ?? 0).toString(16).padStart(6, '0')}`

/** A cell is a terminal character two pixels tall; half blocks pack one pixel in each half. */
export function scenePreviewPixelsOf(
  frame: Pick<ScenePreviewFrame, 'columns' | 'rows' | 'cells'>
): ScenePreviewPixels {
  const width = frame.columns
  const colors: string[] = Array.from({ length: width * frame.rows * 2 }, () => '#000000')
  const glyphs: ScenePreviewPixels['glyphs'] = []
  frame.cells.forEach(([glyph = 0x20, foreground, background], index) => {
    const column = index % width
    const row = Math.floor(index / width)
    const isHalf = glyph === UPPER_HALF
    colors[row * 2 * width + column] = hexOf(isHalf ? foreground : background)
    colors[(row * 2 + 1) * width + column] = hexOf(background)
    if (!isHalf && glyph !== 0x20) {
      glyphs.push({ column, row, text: String.fromCodePoint(glyph), color: hexOf(foreground) })
    }
  })
  return { width, height: frame.rows * 2, colors, glyphs }
}
