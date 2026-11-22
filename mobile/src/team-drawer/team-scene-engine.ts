// Runs inside the Team sheet's WebView, bundled by scripts/build-team-scene-webview-engine.mjs: the
// desktop's own scene painters and director, so the phone draws the stage the desktop panel draws.
import { daylightAt, hourOf } from '../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import {
  orchestratorGameSceneNativeOf,
  type OrchestratorGameSceneNativeStyle
} from '../../../src/shared/orchestrator-game-scene-native'
import { teamSceneActors } from '../../../src/shared/team-scene/team-scene-actors'
import { advisorLineShown } from '../../../src/shared/team-scene/team-scene-advisor-walk'
import {
  applyTeamSceneInput,
  createTeamSceneWorld,
  drainTeamSceneEffects,
  settleTeamScene,
  stepTeamScene,
  type TeamSceneWorld
} from '../../../src/shared/team-scene/team-scene-director'
import type {
  TeamSceneActor,
  TeamSceneInput,
  TeamSceneStation
} from '../../../src/shared/team-scene/team-scene-types'
import questArt from '../../../src/renderer/src/assets/quest-art/native.json'
import { loadTeamSceneArt } from '../../../src/renderer/src/components/team-scene/team-scene-art-load'
import { layoutTeamSceneBubbles } from '../../../src/renderer/src/components/team-scene/team-scene-bubble-layout'
import {
  createTeamSceneFrameLoop,
  type TeamSceneFrameScheduler
} from '../../../src/renderer/src/components/team-scene/team-scene-frame-loop'
import {
  createImagePainter,
  TEAM_SCENE_ART_HEIGHT,
  type TeamSceneArtImage
} from '../../../src/renderer/src/components/team-scene/team-scene-image-painter'
import { OFFICE_BACK_SEAT } from '../../../src/renderer/src/components/team-scene/team-scene-office-back'
import type { TeamScenePainter } from '../../../src/renderer/src/components/team-scene/team-scene-painter'
import { createPixelPainter } from '../../../src/renderer/src/components/team-scene/team-scene-pixel-painter'
import { teamScenePixelSceneOf } from '../../../src/renderer/src/components/team-scene/team-scene-pixel-scene'
import { createTeamSceneNameStrip, TEAM_SCENE_NAME_STRIP } from './team-scene-engine-names'
import type {
  TeamSceneEngineEvent,
  TeamSceneEngineMessage,
  TeamSceneEngineStage
} from './team-scene-engine-messages'

export type { TeamSceneEngineEvent, TeamSceneEngineMessage, TeamSceneEngineStage }

export type TeamSceneEngine = {
  receive: (message: TeamSceneEngineMessage) => Promise<void>
  paint: (dt: number, elapsed?: number) => void
  actors: () => TeamSceneActor[]
  stations: () => TeamSceneStation[]
  dispose: () => void
}

export const teamSceneQuestNativeOf = (
  style: 'figures' | 'office'
): OrchestratorGameSceneNativeStyle => orchestratorGameSceneNativeOf(questArt).native![style]!

const BUBBLE_MAX = 200
const ANCHOR_STEP_PX = 4

function painterOf(
  stage: TeamSceneEngineStage,
  images: ReadonlyMap<string, TeamSceneArtImage> | null
): TeamScenePainter | null {
  const { art, colors } = stage
  if (art.kind === 'pixel') {
    const scene = teamScenePixelSceneOf({
      sceneId: art.sceneId,
      extensions: { scenes: stage.scenes },
      nowMs: stage.nowMs,
      timezone: stage.timezone
    })
    return createPixelPainter({
      scene,
      light: daylightAt(hourOf(stage.nowMs, stage.timezone)),
      colors
    })
  }
  if (!images) {
    return null
  }
  const style = art.kind === 'scene' ? art.native : teamSceneQuestNativeOf(art.style)
  return createImagePainter({
    art: { style, images },
    colors,
    builds: art.style === 'figures' ? 'castle' : 'office',
    // Why only Orca's own desk: the back view knows where its art's side chair ends.
    back: art.style === 'office' && art.kind === 'bundled' ? OFFICE_BACK_SEAT : null
  })
}

/** The desktop stage driven by the sheet's messages, painting into `canvas`. */
export function createTeamSceneEngine(deps: {
  canvas: HTMLCanvasElement
  /** The element over the canvas that holds the speech bubbles. */
  overlay: HTMLElement
  /** The strip under the canvas that holds the figures' names. */
  names: HTMLElement
  width: () => number
  ratio: () => number
  reducedMotion: boolean
  scheduler: TeamSceneFrameScheduler
  decode?: (url: string) => Promise<TeamSceneArtImage>
  post: (event: TeamSceneEngineEvent) => void
}): TeamSceneEngine {
  const { canvas, overlay } = deps
  const world: TeamSceneWorld = createTeamSceneWorld()
  let painter: TeamScenePainter | null = null
  let input: TeamSceneInput | null = null
  let leadLine: string | null = null
  let advisorName = ''
  let actors: TeamSceneActor[] = []
  let bubblesKey = ''
  const bubbles = new Map<string, HTMLElement>()
  const placeNames = createTeamSceneNameStrip(deps.names)
  const placeBubbles = (width: number, height: number): void => {
    const p = painter
    if (!p) {
      return
    }
    const advisor = advisorLineShown(world)
    const anchorOf = (key: string) => {
      const a = actors.find((one) => one.key === key)
      return a ? { x: a.x * width, top: p.headTop(a.depth, height) } : null
    }
    const lines = [
      { key: 'advisor', text: advisor, align: 'end' as const, yields: true },
      { key: 'lead', text: leadLine }
    ].flatMap((one) => {
      const anchor = one.text ? anchorOf(one.key) : null
      return anchor && one.text ? [{ ...one, text: one.text, anchor }] : []
    })
    const key = `${width}|${lines.map((one) => `${one.key}:${one.text}:${Math.round(one.anchor.x / ANCHOR_STEP_PX)}`).join()}`
    if (key === bubblesKey) {
      return
    }
    bubblesKey = key
    for (const [k, el] of bubbles) {
      if (!lines.some((one) => one.key === k)) {
        el.remove()
        bubbles.delete(k)
      }
    }
    const sized = lines.map((one) => {
      let el = bubbles.get(one.key)
      if (!el) {
        el = document.createElement('div')
        el.className = 'bubble'
        el.dataset.sceneBubble = one.key
        overlay.appendChild(el)
        bubbles.set(one.key, el)
      }
      el.textContent = one.text
      el.style.maxWidth = `${Math.min(BUBBLE_MAX, width - 12)}px`
      return { one, el, width: el.offsetWidth || 120, height: el.offsetHeight || 30 }
    })
    const boxes = layoutTeamSceneBubbles(
      sized.map(({ one, width: w, height: h }) => ({
        key: one.key,
        anchor: one.anchor,
        width: w,
        height: h,
        ...('align' in one ? { align: one.align, yields: one.yields } : {})
      })),
      { width, height }
    )
    for (const { one, el } of sized) {
      const box = boxes.find((b) => b.key === one.key)
      el.style.visibility = box ? 'visible' : 'hidden'
      if (box) {
        el.style.left = `${box.left}px`
        el.style.top = `${box.top}px`
      }
    }
  }

  const paint = (dt: number, elapsed = dt): void => {
    const width = deps.width()
    if (!painter || width === 0) {
      return
    }
    const ratio = deps.ratio()
    const { height } = painter
    // Why the CSS height too: the page's canvas starts at the band's 176 pt, and the band shrinks to
    // the stage's height once ready, so a shorter stage left at 176 is stretched and cut off.
    if (
      canvas.width !== Math.round(width * ratio) ||
      canvas.height !== Math.round(height * ratio)
    ) {
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      canvas.style.height = `${height}px`
    }
    stepTeamScene(world, dt, { width, elapsed })
    const g = canvas.getContext('2d')
    if (!g) {
      return
    }
    g.setTransform(ratio, 0, 0, ratio, 0, 0)
    actors = teamSceneActors(world)
    painter.paint(g, {
      width,
      height,
      ratio,
      t: world.clock,
      dt,
      actors,
      effects: drainTeamSceneEffects(world),
      overflow: world.overflow,
      stations: world.stations,
      sites: world.sites,
      trophies: world.trophies,
      stopped: world.stopped
    })
    placeNames(g, actors, width, advisorName)
    placeBubbles(width, height)
  }

  let run = true
  let reduced = deps.reducedMotion
  let failed = false
  // Why: a paint that throws throws again on every frame; stop, and let the sheet fall back.
  const paintOrStop = (dt: number, elapsed = dt): void => {
    if (failed) {
      return
    }
    try {
      paint(dt, elapsed)
    } catch (error) {
      failed = true
      loop.dispose()
      deps.post({ kind: 'error', message: String(error) })
    }
  }
  const loop = createTeamSceneFrameLoop(paintOrStop, deps.scheduler)

  const animate = (): void => {
    if (!painter || !input) {
      return
    }
    loop.setRunning(run && !reduced)
    // Why run too: the sheet keeps its stage loaded at the peek, where even a still frame goes unseen.
    if (reduced && run) {
      settleTeamScene(world)
      paintOrStop(0)
    }
  }

  const apply = (): void => {
    if (!painter || !input) {
      return
    }
    applyTeamSceneInput(world, input, painter.layout)
    animate()
  }

  return {
    receive: async (message) => {
      if (message.kind === 'input') {
        input = message.input
        leadLine = message.leadLine
        advisorName = message.advisorName
        bubblesKey = ''
        apply()
        return
      }
      if (message.kind === 'motion') {
        run = message.run
        // Why either: both read the phone's setting, and a still stage is the safe side.
        reduced = message.reduced || deps.reducedMotion
        animate()
        return
      }
      const { stage } = message
      let images: ReadonlyMap<string, TeamSceneArtImage> | null = null
      if (stage.art.kind !== 'pixel') {
        const style =
          stage.art.kind === 'scene' ? stage.art.native : teamSceneQuestNativeOf(stage.art.style)
        try {
          images = (await loadTeamSceneArt(style, (src) => stage.images[src], deps.decode)).images
        } catch {
          deps.post({ kind: 'artFailed' })
          return
        }
      }
      painter?.dispose()
      painter = painterOf(stage, images)
      deps.post({
        kind: 'ready',
        height: (painter?.height ?? TEAM_SCENE_ART_HEIGHT) + TEAM_SCENE_NAME_STRIP
      })
      apply()
    },
    paint,
    actors: () => actors,
    stations: () => world.stations,
    dispose: () => {
      loop.dispose()
      painter?.dispose()
    }
  }
}
