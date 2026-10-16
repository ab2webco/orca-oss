import { useEffect, useMemo, useRef, useState } from 'react'
import type { OrchestratorGameMode } from '../../../../shared/orchestrator-game-config'
import { normalizeSupportedUiLocale } from '../../../../shared/ui-locale'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import { usePluginPanelsStore } from '../../store/plugin-panels'
import { orchestratorGameSceneOptions } from './orchestrator-game-scene-options'
import {
  PREVIEW_TICK_MS,
  previewSceneOf,
  scenePreviewFrameOf,
  scenePreviewPixelsOf,
  type ScenePreviewFrame
} from './orchestrator-game-scene-preview-frame'
import { sceneLabel } from './OrchestratorGameSceneSelect'
import { getIntlLocale, translate } from '@/i18n/i18n'

const QUEST_OPTION = { value: 'quest', kind: 'built-in', scene: 'quest' } as const

// Canvas pixels per scene pixel; a terminal cell is one pixel wide and two tall.
const PIXEL = 8

function paint(canvas: HTMLCanvasElement, frame: ScenePreviewFrame): void {
  const context = canvas.getContext('2d')
  if (!context) {
    return
  }
  const pixels = scenePreviewPixelsOf(frame)
  pixels.colors.forEach((color, index) => {
    context.fillStyle = color
    context.fillRect(
      (index % pixels.width) * PIXEL,
      Math.floor(index / pixels.width) * PIXEL,
      PIXEL,
      PIXEL
    )
  })
  const mono = getComputedStyle(canvas).getPropertyValue('--font-mono').trim() || 'monospace'
  context.font = `${PIXEL * 1.6}px ${mono}`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  for (const glyph of pixels.glyphs) {
    context.fillStyle = glyph.color
    context.fillText(glyph.text, (glyph.column + 0.5) * PIXEL, (glyph.row * 2 + 1) * PIXEL)
  }
}

const notes = {
  off: (): string =>
    translate(
      'auto.components.settings.OrchestratorGameSetting.previewOff',
      'The game is off, so Agent Teams panes start as plain Claude.'
    ),
  zen: (): string =>
    translate(
      'auto.components.settings.OrchestratorGameSetting.previewZen',
      'Zen draws the same scene and also hides short working notes.'
    ),
  plugin: (): string =>
    translate(
      'auto.components.settings.OrchestratorGameSetting.previewPlugin',
      "This plugin's art is only drawn inside an Agent Teams pane."
    ),
  missing: (): string =>
    translate(
      'auto.components.settings.OrchestratorGameSetting.previewMissing',
      'Not installed, so the game draws Quest.'
    )
}

/** The scene an Agent Teams pane draws on its spinner, painted by the mod's own code. */
export function OrchestratorGameScenePreview({
  scene,
  mode
}: {
  scene: string
  mode: OrchestratorGameMode
}): React.JSX.Element {
  const plugins = usePluginPanelsStore((state) => state.plugins)
  const option = useMemo(
    () =>
      orchestratorGameSceneOptions(plugins, scene).find((entry) => entry.value === scene) ?? {
        value: scene,
        kind: 'missing' as const,
        scene
      },
    [plugins, scene]
  )
  const definition = mode === 'off' ? null : previewSceneOf(option)
  const isReduced = usePrefersReducedMotion()
  const isAnimated = definition !== null && !isReduced
  const [tick, setTick] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const locale = normalizeSupportedUiLocale(getIntlLocale())
  const frame = definition ? scenePreviewFrameOf(definition, isAnimated ? tick : 0, locale) : null

  useEffect(() => {
    if (!isAnimated) {
      return
    }
    const timer = setInterval(() => setTick((value) => value + 1), PREVIEW_TICK_MS)
    return () => clearInterval(timer)
  }, [isAnimated])

  useEffect(() => {
    if (frame && canvasRef.current) {
      paint(canvasRef.current, frame)
    }
  }, [frame])

  const note =
    mode === 'off'
      ? notes.off()
      : option.kind === 'plugin'
        ? notes.plugin()
        : option.kind === 'missing'
          ? notes.missing()
          : mode === 'zen'
            ? notes.zen()
            : null

  return (
    <figure
      data-slot="game-scene-preview"
      data-scene={definition?.id ?? scene}
      data-mode={mode}
      data-phase={frame?.phase}
      data-tick={isAnimated ? tick : 0}
      data-animated={isAnimated}
      aria-label={translate(
        'auto.components.settings.OrchestratorGameSetting.previewLabel',
        'Scene preview'
      )}
      className="space-y-1.5 py-2"
    >
      {frame ? (
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={translate(
            'auto.components.settings.OrchestratorGameSetting.previewImage',
            'Preview of {{value0}}',
            { value0: sceneLabel(option.kind === 'missing' ? QUEST_OPTION : option) }
          )}
          width={frame.columns * PIXEL}
          height={frame.rows * 2 * PIXEL}
          className="block h-auto w-full max-w-[512px] rounded-md border border-border [image-rendering:pixelated]"
        />
      ) : null}
      <figcaption className="text-[11px] text-muted-foreground">
        {frame ? <span>{frame.caption}</span> : null}
        {frame && note ? <span> · </span> : null}
        {note ? <span>{note}</span> : null}
      </figcaption>
    </figure>
  )
}
