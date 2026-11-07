export type TeamSceneBubbleRequest = {
  key: string
  /** The speaker's head: centre x and top y, in scene px. */
  anchor: { x: number; top: number }
  width: number
  height: number
  /** `end` hangs the bubble to the speaker's left, as the advisor's does, leaving room above the lead. */
  align?: 'center' | 'end'
}

export type TeamSceneBubbleBox = {
  key: string
  left: number
  top: number
  width: number
  height: number
  /** Where the tail meets the bubble, from its left edge; it drops straight onto the speaker. */
  tailX: number
}

const EDGE = 6
const GAP = 4
const LIFT = 10
const TAIL_INSET = 10
// Why 14: the lead stands 0.10 of the stage right of the advisor, 22 px on the 219 px panel, and
// its tail must pass this bubble's edge with GAP to spare.
const END_REACH = 14
// A cloud narrowed to share a row may wrap one more line, up to its two-line clamp.
const EXTRA_LINE = 13

const overlaps = (a: TeamSceneBubbleBox, b: TeamSceneBubbleBox): boolean =>
  a.left < b.left + b.width + GAP &&
  b.left < a.left + a.width + GAP &&
  a.top < b.top + b.height + GAP &&
  b.top < a.top + a.height + GAP

type Placed = { box: TeamSceneBubbleBox; anchorTop: number }

/** Whether `tail`'s line from its bubble down to its speaker passes through `box`. */
const tailCrosses = (tail: Placed, box: TeamSceneBubbleBox): boolean => {
  const x = tail.box.left + tail.box.tailX
  const from = tail.box.top + tail.box.height
  return (
    x >= box.left - GAP &&
    x <= box.left + box.width + GAP &&
    box.top < tail.anchorTop &&
    box.top + box.height > from
  )
}

/**
 * Places bubbles in order, each above its speaker with a tail that lands on it. A later one
 * climbs above the ones already placed; it is left out when no spot keeps every bubble and
 * every tail clear of the others, unless `beside` lets it share a row.
 */
export function layoutTeamSceneBubbles(
  requests: readonly TeamSceneBubbleRequest[],
  scene: { width: number; height: number },
  /** Pixel's cloud: its trail drifts toward the speaker, so a shared row is allowed. */
  opts: { beside?: boolean } = {}
): TeamSceneBubbleBox[] {
  const placed: Placed[] = []
  for (const r of requests) {
    const preferred =
      r.align === 'end' ? r.anchor.x - r.width + END_REACH : r.anchor.x - r.width / 2
    const left = Math.max(EDGE, Math.min(scene.width - r.width - EDGE, preferred))
    const tops = [r.anchor.top - r.height - LIFT, ...placed.map((p) => p.box.top - r.height - GAP)]
    const fit = tops
      .map(
        (top): Placed => ({
          box: {
            key: r.key,
            left,
            top,
            width: r.width,
            height: r.height,
            tailX: r.anchor.x - left
          },
          anchorTop: r.anchor.top
        })
      )
      .find(
        (c) =>
          c.box.top >= 0 &&
          c.box.tailX >= TAIL_INSET &&
          c.box.tailX <= r.width - TAIL_INSET &&
          placed.every(
            (p) => !overlaps(c.box, p.box) && !tailCrosses(c, p.box) && !tailCrosses(p, c.box)
          )
      )
    if (fit) {
      placed.push(fit)
      continue
    }
    const row = opts.beside ? besideOf(placed, r, scene.width) : null
    if (row) {
      placed.splice(placed.indexOf(row.moved), 1, row.other, row.added)
    }
  }
  return placed.map((p) => p.box)
}

/**
 * With no room to stack, the newcomer and the last bubble share a row, each as near its
 * speaker as the width allows; the tail stays inside its own bubble, clear of the other.
 */
function besideOf(
  placed: Placed[],
  r: TeamSceneBubbleRequest,
  width: number
): { moved: Placed; other: Placed; added: Placed } | null {
  const moved = placed.at(-1)
  if (!moved) {
    return null
  }
  const newcomer = {
    box: { ...moved.box, key: r.key, width: r.width, height: r.height },
    x: r.anchor.x,
    top: r.anchor.top
  }
  const old = { box: moved.box, x: moved.box.left + moved.box.tailX, top: moved.anchorTop }
  const [first, second] = newcomer.x < old.x ? [newcomer, old] : [old, newcomer]
  const room = width - 2 * EDGE - GAP
  const total = first.box.width + second.box.width
  if (total > room) {
    // Why: a short line, often the lead's tool name, keeps its width up to half the row.
    const [short, long] = first.box.width <= second.box.width ? [first, second] : [second, first]
    const shortWidth = Math.min(short.box.width, Math.floor(room / 2))
    for (const [one, fit] of [
      [short, shortWidth],
      [long, Math.floor(room - shortWidth)]
    ] as const) {
      if (fit < one.box.width) {
        one.box = { ...one.box, width: fit, height: one.box.height + EXTRA_LINE }
      }
    }
  }
  const secondLeft = Math.min(second.x - second.box.width / 2, width - EDGE - second.box.width)
  const firstLeft = Math.max(
    EDGE,
    Math.min(first.x - first.box.width / 2, secondLeft - GAP - first.box.width)
  )
  if (firstLeft + first.box.width + GAP > secondLeft || secondLeft < EDGE) {
    return null
  }
  const at = (one: typeof first, left: number): Placed => {
    const top = Math.max(0, one.top - one.box.height - LIFT)
    const tailX = Math.max(TAIL_INSET, Math.min(one.box.width - TAIL_INSET, one.x - left))
    return { box: { ...one.box, left, top, tailX }, anchorTop: one.top }
  }
  const laid = [at(first, firstLeft), at(second, secondLeft)]
  const added = laid.find((one) => one.box.key === r.key)!
  const other = laid.find((one) => one.box.key !== r.key)!
  const rest = placed.filter((p) => p !== moved)
  const clear = (c: Placed) =>
    rest.every((p) => !overlaps(c.box, p.box) && !tailCrosses(c, p.box) && !tailCrosses(p, c.box))
  return clear(added) && clear(other) ? { moved, other, added } : null
}
