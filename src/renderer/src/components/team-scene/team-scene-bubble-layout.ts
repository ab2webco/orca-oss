export type TeamSceneBubbleRequest = {
  key: string
  /** The speaker's head: centre x and top y, in scene px. */
  anchor: { x: number; top: number }
  width: number
  height: number
}

export type TeamSceneBubbleBox = {
  key: string
  left: number
  top: number
  width: number
  height: number
  /** Where the tail meets the bubble, from its left edge, pointing at the speaker. */
  tailX: number
}

const EDGE = 6
const GAP = 4
const LIFT = 10
const TAIL_INSET = 10

const overlaps = (a: TeamSceneBubbleBox, b: TeamSceneBubbleBox): boolean =>
  a.left < b.left + b.width + GAP &&
  b.left < a.left + a.width + GAP &&
  a.top < b.top + b.height + GAP &&
  b.top < a.top + a.height + GAP

/**
 * Places bubbles in order, each above its speaker; a later one moves beside or above the
 * ones already placed, and is left out when no spot fits, so two bubbles never overlap.
 */
export function layoutTeamSceneBubbles(
  requests: readonly TeamSceneBubbleRequest[],
  scene: { width: number; height: number }
): TeamSceneBubbleBox[] {
  const placed: TeamSceneBubbleBox[] = []
  for (const r of requests) {
    const clampLeft = (left: number): number =>
      Math.max(EDGE, Math.min(scene.width - r.width - EDGE, left))
    const box = (left: number, top: number): TeamSceneBubbleBox => {
      const l = clampLeft(left)
      return {
        key: r.key,
        left: l,
        top,
        width: r.width,
        height: r.height,
        tailX: Math.max(TAIL_INSET, Math.min(r.width - TAIL_INSET, r.anchor.x - l))
      }
    }
    const above = Math.max(EDGE, r.anchor.top - r.height - LIFT)
    const candidates = [box(r.anchor.x - r.width / 2, above)]
    for (const other of placed) {
      candidates.push(
        box(other.left - r.width - GAP, above),
        box(other.left + other.width + GAP, above),
        box(r.anchor.x - r.width / 2, other.top - r.height - GAP)
      )
    }
    const fit = candidates.find(
      (c) =>
        c.top >= 0 &&
        c.left >= 0 &&
        c.left + c.width <= scene.width &&
        placed.every((p) => !overlaps(c, p))
    )
    if (fit) {
      placed.push(fit)
    }
  }
  return placed
}
