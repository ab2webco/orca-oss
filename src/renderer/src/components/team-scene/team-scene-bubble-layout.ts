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
const END_REACH = 22

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
 * every tail clear of the others.
 */
export function layoutTeamSceneBubbles(
  requests: readonly TeamSceneBubbleRequest[],
  scene: { width: number; height: number }
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
    }
  }
  return placed.map((p) => p.box)
}
