// Plays the game's own `/quest demo` with the mod's hd renderer, as an Agent Teams pane draws it.
import {
  demoFrameOf,
  DEMO_STEP_TICKS
} from '../../../resources/claude-plugins/orca-game/hooks/demo'
import {
  gameLocaleOf,
  setGameLocale
} from '../../../resources/claude-plugins/orca-game/hooks/game-strings'
import { dayOf } from '../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import { partyOf } from '../../../resources/claude-plugins/orca-game/hooks/party'
import { SCENE_TICK_MS } from '../../../resources/claude-plugins/orca-game/hooks/scene'
import {
  HD_MAX_ROWS,
  hdSceneGridOf
} from '../../../resources/claude-plugins/orca-game/hooks/scene-hd'
import { sceneOf } from '../../../resources/claude-plugins/orca-game/hooks/scenes/index'
import { themedSceneOf } from '../../../resources/claude-plugins/orca-game/hooks/scenes/scene-theme'
import { scenePreviewPixelsOf } from '../../../src/renderer/src/components/settings/orchestrator-game-scene-preview-frame'

type Band = {
  root: HTMLElement
  canvas: HTMLCanvasElement
  caption: HTMLElement | null
  sceneId: string
  tick: number
  step: number
  stepAt: number
  levelAt: number | undefined
  timer: number | undefined
  isVisible: boolean
}

function draw(band: Band): void {
  const { canvas } = band
  const width = canvas.clientWidth
  const rows = HD_MAX_ROWS
  // Why the CSS height: one place sets the pixel size per breakpoint, so the band never reflows.
  const pixel = Math.round(canvas.clientHeight / (rows * 2))
  if (width === 0 || pixel === 0) {
    return
  }
  const columns = Math.max(48, Math.ceil(width / pixel))
  const frame = demoFrameOf(band.step)
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const scene = themedSceneOf(sceneOf(band.sceneId), dayOf(Date.now(), zone))
  const cells = hdSceneGridOf({
    scene,
    phase: frame.phase,
    columns,
    rows,
    tick: band.tick,
    caption: frame.caption,
    since: band.stepAt,
    reaction:
      band.levelAt === undefined ? undefined : { kind: 'level', age: band.tick - band.levelAt },
    isResting: frame.isResting,
    action: frame.action,
    party: partyOf(frame.state, true).map(({ key, name, phase, state }) => ({
      key,
      name,
      phase,
      state
    }))
  })
  const pixels = scenePreviewPixelsOf({ columns, rows, cells })
  if (canvas.width !== columns * pixel || canvas.height !== rows * 2 * pixel) {
    canvas.width = columns * pixel
    canvas.height = rows * 2 * pixel
  }
  const context = canvas.getContext('2d')
  if (!context) {
    return
  }
  pixels.colors.forEach((color, index) => {
    context.fillStyle = color
    context.fillRect((index % columns) * pixel, Math.floor(index / columns) * pixel, pixel, pixel)
  })
  const mono = getComputedStyle(canvas).getPropertyValue('--font-mono').trim() || 'monospace'
  context.font = `${pixel * 1.6}px ${mono}`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  for (const glyph of pixels.glyphs) {
    context.fillStyle = glyph.color
    context.fillText(glyph.text, (glyph.column + 0.5) * pixel, (glyph.row * 2 + 1) * pixel)
  }
  if (band.caption) {
    // Why without the prefix: the strip already says it is the demo; the cloud types it out slowly.
    band.caption.textContent = frame.caption.replace(/^DEMO · /, '') || '…'
  }
}

function advance(band: Band): void {
  band.tick += 1
  if (band.tick - band.stepAt >= DEMO_STEP_TICKS) {
    band.stepAt = band.tick
    band.step += 1
    if (demoFrameOf(band.step).isLevelUp) {
      band.levelAt = band.tick
    }
  }
  draw(band)
}

function setRunning(band: Band, isRunning: boolean): void {
  if (isRunning && band.timer === undefined) {
    band.timer = window.setInterval(() => advance(band), SCENE_TICK_MS)
  } else if (!isRunning && band.timer !== undefined) {
    window.clearInterval(band.timer)
    band.timer = undefined
  }
}

export function mountQuestBand(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')
  if (!canvas) {
    return
  }
  setGameLocale(gameLocaleOf(document.documentElement.lang))
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const band: Band = {
    root,
    canvas,
    caption: root.querySelector('[data-band-caption]'),
    sceneId: root.dataset.scene ?? 'quest',
    // Why tick 30 of step 1: the still frame for reduced motion shows the team mid-build.
    tick: 30,
    step: 1,
    stepAt: 0,
    levelAt: undefined,
    timer: undefined,
    isVisible: false
  }
  const sync = (): void => setRunning(band, band.isVisible && !reduced.matches && !document.hidden)
  new IntersectionObserver(([entry]) => {
    band.isVisible = entry?.isIntersecting ?? false
    sync()
  }).observe(canvas)
  reduced.addEventListener('change', sync)
  document.addEventListener('visibilitychange', sync)
  new ResizeObserver(() => draw(band)).observe(canvas)

  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-scene-pick]')) {
    button.addEventListener('click', () => {
      band.sceneId = button.dataset.scenePick ?? 'quest'
      root.dataset.scene = band.sceneId
      for (const other of root.querySelectorAll('[data-scene-pick]')) {
        other.setAttribute('aria-pressed', String(other === button))
      }
      draw(band)
    })
  }
  draw(band)
}
