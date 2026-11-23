import { useTeamSceneHover } from './team-scene-hit'

// Why the 2D scenes' store: a Team row lights its figure and a figure its row, in every scene
// (ORCA-1336); the 3D ones only add how to find a figure under the pointer and how to mark it.

type Point = { x: number; y: number }
type Size = { width: number; height: number }

/** The link's hover state, kept by the caller across rebuilds of the stage (ORCA-1336). */
export type Scene3dHoverHold = { own: string | null; down: Point | null }

/** Below this many pixels between press and click, a click is a click and not a drag's end. */
const CLICK_PX = 4

/**
 * Wires a 3D scene's canvas to the hover store: the figure under the pointer lights its row, the
 * row under the pointer marks its figure (`light`), and a click opens the figure as its row does.
 */
export function linkScene3dHover(args: {
  el: EventTarget & { getBoundingClientRect: () => DOMRect }
  pick: (at: Point, size: Size) => string | null
  light: (key: string | null) => void
  open: (key: string) => void
  /** Kept by the caller, so a rebuild that relinks does not forget the row or figure it lit. */
  hold: Scene3dHoverHold
}): () => void {
  const { el, pick, light, open, hold } = args
  const hitAt = (e: Event): string | null => {
    const { clientX, clientY } = e as MouseEvent
    const r = el.getBoundingClientRect()
    return pick({ x: clientX - r.left, y: clientY - r.top }, { width: r.width, height: r.height })
  }
  const point = (key: string | null) => {
    // Why only our own: leaving the stage keeps a row the Team list is lighting.
    const own = hold.own
    if (key !== own && (key !== null || useTeamSceneHover.getState().key === own)) {
      useTeamSceneHover.getState().set(key)
    }
    hold.own = key
  }
  const handlers: [string, (e: Event) => void][] = [
    // Why not during a drag: the camera owns the pointer then, and panning would flicker the rows.
    [
      'pointermove',
      (e) =>
        (e as PointerEvent).pointerType !== 'touch' &&
        (e as PointerEvent).buttons === 0 &&
        point(hitAt(e))
    ],
    ['pointerleave', () => point(null)],
    [
      'pointerdown',
      (e) => (hold.down = { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY })
    ],
    [
      'click',
      (e) => {
        const { clientX, clientY } = e as MouseEvent
        const down = hold.down
        const still = down && Math.hypot(clientX - down.x, clientY - down.y) < CLICK_PX
        hold.down = null
        const key = still ? hitAt(e) : null
        if (key) {
          open(key)
        }
      }
    ]
  ]
  for (const [type, fn] of handlers) {
    el.addEventListener(type, fn)
  }
  light(useTeamSceneHover.getState().key)
  const unsubscribe = useTeamSceneHover.subscribe((s) => light(s.key))
  return () => {
    unsubscribe()
    for (const [type, fn] of handlers) {
      el.removeEventListener(type, fn)
    }
  }
}
