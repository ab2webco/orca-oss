import { create } from 'zustand'
import type { TeamSceneActor } from '../../../../shared/team-scene/team-scene-types'
import type { TeamScenePainter } from './team-scene-painter'

export type TeamSceneBox = { left: number; top: number; width: number; height: number }

// Why a share of the height: every style's figure is about this wide for its height.
const [HALF_WIDTH, MIN_HALF_PX] = [0.32, 8]

/** An actor's bounds on the stage: head to feet, about a body wide (ORCA-1219). */
export function teamSceneActorBox(
  a: Pick<TeamSceneActor, 'x' | 'depth' | 'jump'>,
  painter: Pick<TeamScenePainter, 'headTop' | 'feetAt'>,
  width: number,
  height: number
): TeamSceneBox {
  const top = painter.headTop(a.depth, height) - a.jump
  const feet = (painter.feetAt?.(a.depth, height) ?? height) - a.jump
  const half = Math.max(MIN_HALF_PX, (feet - top) * HALF_WIDTH)
  return { left: a.x * width - half, top, width: 2 * half, height: Math.max(0, feet - top) }
}

/** The member drawn under `point`: the frontmost whose box holds it, the nearest on a tie. */
export function teamSceneMemberAt(
  actors: readonly TeamSceneActor[],
  point: { x: number; y: number },
  boxOf: (a: TeamSceneActor) => TeamSceneBox
): string | null {
  const hits = actors.flatMap((a) => {
    if (a.role !== 'member') {
      return []
    }
    const box = boxOf(a)
    const inside =
      point.x >= box.left &&
      point.x <= box.left + box.width &&
      point.y >= box.top &&
      point.y <= box.top + box.height
    return inside ? [{ a, off: Math.abs(box.left + box.width / 2 - point.x) }] : []
  })
  hits.sort((p, q) => q.a.depth - p.a.depth || p.off - q.off)
  return hits[0]?.a.key ?? null
}

/** The member pointed at in the scene or in the Team list, so each lights the other. */
export const useTeamSceneHover = create<{ key: string | null; set: (key: string | null) => void }>(
  (set) => ({ key: null, set: (key) => set({ key }) })
)

/** What the scene says about a member under the pointer, and how to open it as its row does. */
export type TeamSceneWho = { title: string; detail: string; open: () => void }

/** A lit member's outline on the stage, in the working tone, a little outside its box. */
export function drawTeamSceneHighlight(
  g: CanvasRenderingContext2D,
  box: TeamSceneBox,
  color: string
): void {
  g.save()
  g.strokeStyle = color
  g.lineWidth = 2
  g.beginPath()
  g.roundRect(box.left - 2, box.top - 2, box.width + 4, box.height + 4, 6)
  g.stroke()
  g.restore()
}

/** A Team row's half of the link: lit while its figure is pointed at, and lighting it on hover. */
export function useTeamSceneHoverRow(key: string) {
  const lit = useTeamSceneHover((s) => s.key === key)
  const set = useTeamSceneHover((s) => s.set)
  return {
    lit,
    rowProps: {
      'data-team-card-lit': lit ? '' : undefined,
      onPointerEnter: () => set(key),
      onPointerLeave: () => useTeamSceneHover.getState().key === key && set(null)
    }
  }
}
