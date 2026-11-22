import {
  teamDioramaLayoutOf,
  type DioramaMachine,
  type DioramaOrder
} from '../../../src/shared/team-scene/team-diorama-layout'
import { teamOffice3dLayoutOf } from '../../../src/shared/team-scene/team-office3d-layout'
import {
  office3dTraffic,
  office3dTrafficRead
} from '../../../src/shared/team-scene/team-office3d-traffic'
import type { TeamSceneFloor } from '../../../src/shared/team-scene/team-scene-floors'
import type { TeamSceneInput } from '../../../src/shared/team-scene/team-scene-types'
import {
  dioramaCuesAfter,
  dioramaMoments,
  dioramaViewsOf
} from '../../../src/renderer/src/components/team-scene/team-diorama-read'
import {
  dioramaRenderer,
  dioramaStage
} from '../../../src/renderer/src/components/team-scene/team-diorama-stage'
import { office3dDefaultHeight } from '../../../src/renderer/src/components/team-scene/team-office3d-height'
import { office3dStage } from '../../../src/renderer/src/components/team-scene/team-office3d-stage'
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

// Why the desktop's own stages: the phone draws the 3D scenes the panel draws, in the same WebView
// that draws the 2D styles; it takes over only for Figures' diorama (ORCA-1296) and the 3D Office
// (ORCA-1334), and only where WebGL opens.

const FRAME_MS = 1000 / 30
const PHONE_MAX_HEIGHT = 300

type Gl = NonNullable<ReturnType<typeof dioramaRenderer>>
type Read = {
  input: TeamSceneInput
  machines: DioramaMachine[]
  floors: TeamSceneFloor[] | undefined
}
type Colors = TeamSceneEngineStage['colors']
type Office = NonNullable<TeamSceneEngineStage['office3d']>
type Figures = NonNullable<TeamSceneEngineStage['diorama']>

type Scheduler = { request: (cb: (now: number) => void) => number; cancel: (id: number) => void }

export type TeamSceneDioramaEngine = {
  /** Takes a stage that asks for a 3D scene where WebGL opens; false hands it to the 2D engine. */
  take: (stage: TeamSceneEngineStage) => boolean
  input: (
    input: TeamSceneInput,
    machines: DioramaMachine[] | undefined,
    floors?: TeamSceneFloor[]
  ) => void
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
  let renderer: Gl | null = null
  let wanted: TeamSceneEngineStage | null = null
  let read: Read | null = null
  let order: DioramaOrder | undefined
  let officeOrder: Record<string, (string | null)[]> | undefined
  // Why kept: each read rebuilds the stage, and a lead's trip under way must carry on.
  const traffic = office3dTraffic()
  let stage: { height: number; draw: (t: number) => void; dispose: () => void } | null = null
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
    // Why the Office on performance.now: its traffic is read on the clock the desktop uses.
    stage?.draw(reduced ? 1.3 : (wanted?.office3d ? performance.now() : Date.now()) / 1000)
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
  const officeStage = (gl: Gl, width: number, status: Colors, want: Office, at: Read) => {
    const layout = teamOffice3dLayoutOf(at.floors ?? [], {
      leadAdvisor: at.input.advisor !== null,
      previous: officeOrder
    })
    officeOrder = layout.order
    office3dTrafficRead(traffic, layout, at.input, performance.now() / 1000, want.pace)
    const machines = layout.floors.filter((f) => !f.lobby).length
    return office3dStage(gl, {
      width,
      height: Math.min(PHONE_MAX_HEIGHT, office3dDefaultHeight(machines)),
      dark: deps.dark(),
      status,
      input: at.input,
      layout,
      pace: want.pace,
      view,
      traffic,
      words: want.words
    })
  }
  const figuresStage = (gl: Gl, width: number, status: Colors, want: Figures, at: Read) => {
    const layout = teamDioramaLayoutOf(at.machines, order, width < 300)
    order = layout.order
    const cues = dioramaCuesAfter(moments, at.input, layout, Date.now() / 1000, reduced)
    return dioramaStage(gl, {
      width,
      dark: deps.dark(),
      status,
      input: at.input,
      layout,
      views: dioramaViewsOf(at.input),
      cues,
      lite: want.quality === 'low',
      pace: want.pace,
      view,
      maxHeight: PHONE_MAX_HEIGHT
    })
  }
  const build = () => {
    if (!renderer || !wanted || !read) {
      return
    }
    const { colors, office3d, diorama } = wanted
    const width = deps.width()
    stage?.dispose()
    stage = office3d
      ? officeStage(renderer, width, colors, office3d, read)
      : diorama
        ? figuresStage(renderer, width, colors, diorama, read)
        : null
    if (!stage) {
      return
    }
    deps.post({ kind: 'ready', height: stage.height, camera: view.mode })
    draw()
    start()
  }

  return {
    take: (next) => {
      const threeD =
        (next.diorama && next.art.kind === 'bundled' && next.art.style === 'figures') ||
        next.office3d !== undefined
      // Why alpha: the Office stands on the page's own background, as on the desktop.
      if (!renderer && threeD) {
        renderer = dioramaRenderer(deps.canvas, true)
      }
      // Why a fresh aim: the camera sits in the last scene's world, which the other style does not share.
      if (wanted && threeD && Boolean(wanted.office3d) !== Boolean(next.office3d)) {
        view.target = null
      }
      wanted = threeD && renderer ? next : null
      if (!wanted) {
        stop()
        stage?.dispose()
        stage = null
        return false
      }
      build()
      return true
    },
    input: (input, machines, floors) => {
      read = { input, machines: machines ?? homeOnly(input), floors }
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
