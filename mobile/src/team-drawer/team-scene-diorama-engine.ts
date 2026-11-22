import {
  teamDioramaLayoutOf,
  type DioramaMachine,
  type DioramaOrder
} from '../../../src/shared/team-scene/team-diorama-layout'
import type { TeamSceneInput } from '../../../src/shared/team-scene/team-scene-types'
import {
  dioramaCuesAfter,
  dioramaMoments,
  dioramaViewsOf
} from '../../../src/renderer/src/components/team-scene/team-diorama-read'
import {
  dioramaRenderer,
  dioramaStage,
  type DioramaStage
} from '../../../src/renderer/src/components/team-scene/team-diorama-stage'
import {
  dioramaPan,
  dioramaView,
  dioramaZoomBy
} from '../../../src/renderer/src/components/team-scene/team-diorama-view'
import type {
  TeamSceneEngineEvent,
  TeamSceneEngineMessage,
  TeamSceneEngineStage
} from './team-scene-engine-messages'

// Why the desktop's own stage: the phone draws the diorama the panel draws, in the same WebView
// that draws the 2D styles; it takes over only for Figures, and only where WebGL opens (ORCA-1296).

const FRAME_MS = 1000 / 30
const PHONE_MAX_HEIGHT = 300

type Scheduler = { request: (cb: (now: number) => void) => number; cancel: (id: number) => void }

export type TeamSceneDioramaEngine = {
  /** Takes the stage when it asks for the diorama and WebGL opens; false hands it to the 2D engine. */
  take: (stage: TeamSceneEngineStage) => boolean
  input: (input: TeamSceneInput, machines: DioramaMachine[] | undefined) => void
  motion: (run: boolean, reduced: boolean) => void
  camera: (message: Extract<TeamSceneEngineMessage, { kind: 'camera' }>) => void
}

/** One home island for a host that names no machines. */
const homeOnly = (input: TeamSceneInput): DioramaMachine[] => [
  {
    key: '',
    name: '',
    home: true,
    reachable: true,
    members: input.members.map((m) => m.key),
    cap: null,
    taken: 0
  }
]

export function createTeamSceneDioramaEngine(deps: {
  canvas: HTMLCanvasElement
  width: () => number
  dark: () => boolean
  scheduler: Scheduler
  post: (event: TeamSceneEngineEvent) => void
}): TeamSceneDioramaEngine {
  const view = dioramaView()
  const moments = dioramaMoments()
  let renderer: ReturnType<typeof dioramaRenderer> = null
  let wanted: TeamSceneEngineStage | null = null
  let read: { input: TeamSceneInput; machines: DioramaMachine[] } | null = null
  let order: DioramaOrder | undefined
  let stage: DioramaStage | null = null
  let frame: number | null = null
  let last = 0
  let run = false
  let reduced = false

  const stop = () => {
    if (frame !== null) {
      deps.scheduler.cancel(frame)
      frame = null
    }
  }
  const draw = () => {
    if (reduced) {
      view.target = null
    }
    stage?.draw(reduced ? 1.3 : Date.now() / 1000)
  }
  const loop = (now: number) => {
    frame = deps.scheduler.request(loop)
    if (now - last >= FRAME_MS) {
      last = now
      draw()
    }
  }
  const start = () => {
    stop()
    if (run && !reduced && stage) {
      frame = deps.scheduler.request(loop)
    }
  }
  const build = () => {
    if (!renderer || !wanted?.diorama || !read) {
      return
    }
    const width = deps.width()
    const layout = teamDioramaLayoutOf(read.machines, order, width < 300)
    order = layout.order
    const cues = dioramaCuesAfter(moments, read.input, layout, Date.now() / 1000, reduced)
    stage?.dispose()
    stage = dioramaStage(renderer, {
      width,
      dark: deps.dark(),
      status: wanted.colors,
      input: read.input,
      layout,
      views: dioramaViewsOf(read.input),
      cues,
      lite: wanted.diorama.quality === 'low',
      pace: wanted.diorama.pace,
      view,
      maxHeight: PHONE_MAX_HEIGHT
    })
    deps.post({ kind: 'ready', height: stage.height, camera: view.mode })
    draw()
    start()
  }

  return {
    take: (next) => {
      const figures = next.art.kind === 'bundled' && next.art.style === 'figures'
      if (!renderer && next.diorama && figures) {
        renderer = dioramaRenderer(deps.canvas)
      }
      wanted = next.diorama && figures && renderer ? next : null
      if (!wanted) {
        stop()
        stage?.dispose()
        stage = null
        return false
      }
      build()
      return true
    },
    input: (input, machines) => {
      read = { input, machines: machines ?? homeOnly(input) }
      build()
    },
    motion: (nextRun, nextReduced) => {
      run = nextRun
      reduced = nextReduced
      start()
    },
    // Why the sheet's fingers, not the page's: its gestures decide whether a drag moves the camera
    // or the sheet, and the desktop's pan and zoom keep its limits and its hand-off to free.
    camera: ({ mode, pan, zoom }) => {
      if (mode) {
        view.mode = mode
      }
      if (pan) {
        dioramaPan(view, pan[0], pan[1])
      }
      if (zoom) {
        dioramaZoomBy(view, zoom)
      }
      if (reduced) {
        draw()
      }
      deps.post({ kind: 'camera', mode: view.mode })
    }
  }
}
