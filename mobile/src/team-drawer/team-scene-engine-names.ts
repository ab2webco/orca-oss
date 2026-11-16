// The Team scene WebView's names: a strip under the stage, so the art stays the desktop's and no
// name covers a figure, its status mark or the ground.
import type { TeamSceneActor } from '../../../src/shared/team-scene/team-scene-types'

export const TEAM_SCENE_NAME_FONT = '600 10px -apple-system, system-ui, sans-serif'
/** One label's height; the strip holds two rows of them. */
export const TEAM_SCENE_NAME_ROW = 13
const ROW_TOP = 2
const ROW_GAP = 2
export const TEAM_SCENE_NAME_STRIP = 2 * ROW_TOP + 2 * TEAM_SCENE_NAME_ROW + ROW_GAP
const GAP = 4
const MAX = 96
const PAD = 8
const STEP_PX = 4

export type TeamSceneNameBox = {
  key: string
  name: string
  left: number
  top: number
  width: number
}

type Wanted = { key: string; name: string; x: number; width: number; left: number }

// Keeps a row's order and pushes its labels apart; when the row cannot hold them all at full
// width, every one narrows alike (the page ellipsizes it), so no figure loses its name.
function packRow(row: readonly Wanted[], stripWidth: number): Wanted[] {
  const room = stripWidth - GAP * Math.max(0, row.length - 1)
  const total = row.reduce((sum, one) => sum + one.width, 0)
  const scale = total > room ? room / total : 1
  const boxes = row.map((one) => {
    const width = scale < 1 ? Math.floor(one.width * scale) : one.width
    return { ...one, width, left: Math.min(Math.max(one.x - width / 2, 0), stripWidth - width) }
  })
  for (let at = 1; at < boxes.length; at++) {
    const before = boxes[at - 1]!
    boxes[at]!.left = Math.max(boxes[at]!.left, before.left + before.width + GAP)
  }
  for (let at = boxes.length - 1; at >= 0; at--) {
    const limit = at === boxes.length - 1 ? stripWidth : boxes[at + 1]!.left - GAP
    boxes[at]!.left = Math.min(boxes[at]!.left, limit - boxes[at]!.width)
  }
  return boxes
}

/**
 * One label per figure, under its x when there is room: on the first row when it fits there,
 * else the second, pushed aside and narrowed rather than touching a neighbour or leaving the
 * strip. `width` is the label's whole name with its padding.
 */
export function layoutTeamSceneNames(
  figures: readonly { key: string; name: string; x: number; width: number }[],
  stripWidth: number
): TeamSceneNameBox[] {
  const wanted: Wanted[] = [...figures]
    .sort((a, b) => a.x - b.x)
    .map((one) => {
      // Why clamped: a figure walking on from off stage still gets its label at the edge.
      const x = Math.min(Math.max(one.x, 0), stripWidth)
      const width = Math.min(one.width, MAX, stripWidth)
      return { ...one, x, width, left: Math.min(Math.max(x - width / 2, 0), stripWidth - width) }
    })
  const ends = [-Infinity, -Infinity]
  const rows: Wanted[][] = [[], []]
  for (const one of wanted) {
    // Why up to its x: a label nudged past its neighbour still sits under its own figure.
    const fits = ends.findIndex(
      (end) => Math.max(one.left, end + GAP) <= Math.min(one.x, stripWidth - one.width)
    )
    const row = fits !== -1 ? fits : ends[0]! <= ends[1]! ? 0 : 1
    rows[row]!.push(one)
    ends[row] = Math.max(one.left, ends[row]! + GAP) + one.width
  }
  return rows.flatMap((row, r) =>
    packRow(row, stripWidth).map((one) => ({
      key: one.key,
      name: one.name,
      left: one.left,
      top: ROW_TOP + r * (TEAM_SCENE_NAME_ROW + ROW_GAP),
      width: one.width
    }))
  )
}

/** Keeps `strip`'s labels on the figures' names; writes the page only when a label moves. */
export function createTeamSceneNameStrip(
  strip: HTMLElement
): (g: CanvasRenderingContext2D, actors: readonly TeamSceneActor[], width: number) => void {
  const labels = new Map<string, HTMLElement>()
  let shown = ''
  return (g, actors, width) => {
    g.font = TEAM_SCENE_NAME_FONT
    const boxes = layoutTeamSceneNames(
      actors
        .filter((a) => !a.away)
        .map((a) => ({
          key: a.key,
          name: a.name,
          x: a.x * width,
          // Why up to a whole px: a box a fraction narrower than its text shows an ellipsis.
          width: Math.ceil(g.measureText(a.name).width) + PAD
        })),
      width
    )
    // Why by a few px: a walker's label follows it without a page write every frame.
    const key = boxes
      .map(
        (b) =>
          `${b.key}:${b.name}:${b.top}:${[b.left, b.width].map((n) => Math.round(n / STEP_PX))}`
      )
      .join()
    if (key === shown) {
      return
    }
    shown = key
    for (const [k, el] of labels) {
      if (!boxes.some((b) => b.key === k)) {
        el.remove()
        labels.delete(k)
      }
    }
    for (const b of boxes) {
      let el = labels.get(b.key)
      if (!el) {
        el = document.createElement('div')
        el.className = 'name'
        el.dataset.sceneName = b.key
        strip.appendChild(el)
        labels.set(b.key, el)
      }
      el.textContent = b.name
      Object.assign(el.style, {
        left: `${b.left}px`,
        top: `${b.top}px`,
        width: `${b.width}px`,
        height: `${TEAM_SCENE_NAME_ROW}px`
      })
    }
  }
}
