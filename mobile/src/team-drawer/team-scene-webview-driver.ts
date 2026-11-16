import {
  createTeamSceneFrameLoop,
  type TeamSceneFrameScheduler
} from '../../../src/renderer/src/components/team-scene/team-scene-frame-loop'
import type { TeamScenePainter } from '../../../src/renderer/src/components/team-scene/team-scene-painter'
import { teamSceneActors } from '../../../src/shared/team-scene/team-scene-actors'
import {
  applyTeamSceneInput,
  createTeamSceneWorld,
  drainTeamSceneEffects,
  settleTeamScene,
  stepTeamScene
} from '../../../src/shared/team-scene/team-scene-director'
import {
  teamSceneEngineCommandOf,
  type TeamSceneEngineEvent,
  type TeamSceneEngineSetup
} from './team-scene-webview-messages'

/** The part of the WebView's canvas the engine uses. */
export type TeamSceneEngineCanvas = {
  width: number
  height: number
  readonly clientWidth: number
  style: { height: string }
  getContext: (kind: '2d') => CanvasRenderingContext2D | null
}

export type TeamSceneEngineHost = {
  canvas: TeamSceneEngineCanvas
  ratio: () => number
  scheduler: TeamSceneFrameScheduler
  post: (event: TeamSceneEngineEvent) => void
  /** Injected, so the painter code (WebView only, never Hermes) stays out of the app's graph. */
  makePainter: (setup: TeamSceneEngineSetup) => TeamScenePainter
}

export type TeamSceneEngine = {
  receive: (raw: unknown) => void
  /** The WebView changed size; a reduced-motion scene repaints, a running one waits for its frame. */
  resize: () => void
  dispose: () => void
}

/** The desktop canvas's step-and-paint (TeamSceneCanvas.tsx), driven by the app's messages. */
export function createTeamSceneEngine(host: TeamSceneEngineHost): TeamSceneEngine {
  const { canvas } = host
  const world = createTeamSceneWorld()
  let stage: { key: string; painter: TeamScenePainter } | null = null
  let reducedMotion = false
  let running = true
  let failed = false
  let drawnHeight: number | null = null

  const fail = (error: unknown): void => {
    failed = true
    loop.setRunning(false)
    host.post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }

  const paint = (dt: number, elapsed = dt): void => {
    const width = canvas.clientWidth
    if (!stage || failed || width === 0) {
      return
    }
    const { painter } = stage
    const ratio = host.ratio()
    const { height } = painter
    try {
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
        throw new Error('No 2D canvas context')
      }
      g.setTransform(ratio, 0, 0, ratio, 0, 0)
      painter.paint(g, {
        width,
        height,
        ratio,
        t: world.clock,
        dt,
        actors: teamSceneActors(world),
        effects: drainTeamSceneEffects(world),
        overflow: world.overflow,
        stations: world.stations,
        sites: world.sites,
        trophies: world.trophies,
        stopped: world.stopped
      })
    } catch (error) {
      fail(error)
      return
    }
    if (drawnHeight !== height) {
      drawnHeight = height
      host.post({ type: 'drawn', height })
    }
  }

  const loop = createTeamSceneFrameLoop(paint, host.scheduler)
  const sync = (): void => loop.setRunning(running && !reducedMotion && stage !== null && !failed)

  const receive = (raw: unknown): void => {
    if (failed) {
      return
    }
    const command = teamSceneEngineCommandOf(raw)
    if (!command) {
      host.post({ type: 'error', message: 'Unreadable scene command' })
      return
    }
    if (command.type === 'run') {
      running = command.running
      sync()
      return
    }
    try {
      // Why by text: each poll sends a new object, and a new painter drops its baked backdrop.
      const key = JSON.stringify(command.setup)
      if (stage?.key !== key) {
        stage?.painter.dispose()
        stage = null
        stage = { key, painter: host.makePainter(command.setup) }
      }
      reducedMotion = command.reducedMotion
      applyTeamSceneInput(world, command.input, stage.painter.layout)
      if (reducedMotion) {
        settleTeamScene(world)
        paint(0)
      }
    } catch (error) {
      fail(error)
      return
    }
    sync()
  }

  return {
    receive,
    resize: () => {
      if (reducedMotion) {
        paint(0)
      }
    },
    dispose: () => {
      loop.dispose()
      stage?.painter.dispose()
      stage = null
    }
  }
}
