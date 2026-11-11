export type TeamSceneBubbleRequest = {
  key: string
  /** The speaker's head: centre x and top y, in scene px. */
  anchor: { x: number; top: number }
  width: number
  height: number
  /** `end` hangs the bubble to the speaker's left, as the advisor's does, leaving room above the lead. */
  align?: 'center' | 'end'
  /** Left out when that lets a bubble that does not yield show instead. */
  yields?: boolean
  /** The lead standing by an asking member: its tail may pass behind a tag when nothing else fits. */
  attending?: boolean
  /** Its size on one line, for an attending lead whose full line finds no spot; it clamps to it. */
  oneLine?: { width: number; height: number }
}

/** Something on stage a bubble must not cover, such as an asking member's tag. */
export type TeamSceneRect = { left: number; top: number; width: number; height: number }

export type TeamSceneBubbleBox = {
  key: string
  left: number
  top: number
  width: number
  height: number
  /** Where the tail meets the bubble, from its left edge; it drops straight onto the speaker. */
  tailX: number
  /** Laid out on one line, so the bubble shows it clamped with an ellipsis. */
  clamped?: true
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
// How far a tail stops short of a tag it passes behind.
const TAIL_CLEAR = 1

const overlaps = (a: TeamSceneRect, b: TeamSceneRect): boolean =>
  a.left < b.left + b.width + GAP &&
  b.left < a.left + a.width + GAP &&
  a.top < b.top + b.height + GAP &&
  b.top < a.top + a.height + GAP

type Placed = { box: TeamSceneBubbleBox; anchorTop: number }

/** Whether `tail`'s line from its bubble down to its speaker passes through `box`. */
const tailCrosses = (tail: Placed, box: TeamSceneRect): boolean => {
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
 * climbs above the ones already placed, and any bubble steps aside or climbs off an obstacle; it
 * is left out when no spot keeps every bubble and every tail clear, unless `beside` lets it share a row.
 */
export function layoutTeamSceneBubbles(
  requests: readonly TeamSceneBubbleRequest[],
  /** `top`: where the stage starts to show, as a building floor crops its sky; 0 when whole. */
  scene: { width: number; height: number; top?: number },
  /** Pixel's cloud: its trail drifts toward the speaker, so a shared row is allowed. */
  opts: { beside?: boolean; obstacles?: readonly TeamSceneRect[] } = {}
): TeamSceneBubbleBox[] {
  const all = placeBubbles(requests, scene, opts)
  const firm = requests.filter((r) => !r.yields)
  if (all.length === requests.length || firm.length === requests.length) {
    return all
  }
  // Why a second pass: placed first, a yielding bubble can take the only room (ORCA-1139).
  const firmShown = (boxes: TeamSceneBubbleBox[]) =>
    boxes.filter((box) => firm.some((r) => r.key === box.key)).length
  const without = placeBubbles(firm, scene, opts)
  return firmShown(without) > firmShown(all) ? without : all
}

function placeBubbles(
  requests: readonly TeamSceneBubbleRequest[],
  scene: { width: number; height: number; top?: number },
  opts: { beside?: boolean; obstacles?: readonly TeamSceneRect[] }
): TeamSceneBubbleBox[] {
  const obstacles = opts.obstacles ?? []
  const placed: Placed[] = []
  for (const r of requests) {
    const fitOf = (req: TeamSceneBubbleRequest): Placed | undefined => {
      const candidates = candidatesOf(req, scene, placed, obstacles)
      // Why behind a tag only as a last resort: the lead stands under the tag of the member it attends.
      return (
        candidates.find((c) => clearOf(c, placed, obstacles)) ??
        (req.attending
          ? candidates.find((c) => clearOf(c, placed, obstacles, { tailBehindTags: true }))
          : undefined)
      )
    }
    const full = fitOf(r)
    // Why one line next: by an asker on a narrow stage two lines have no room, and the card has it all.
    const short = !full && r.attending && r.oneLine ? fitOf({ ...r, ...r.oneLine }) : undefined
    const fit = full ?? (short && { ...short, box: { ...short.box, clamped: true as const } })
    if (fit) {
      placed.push(fit)
      continue
    }
    const row = opts.beside ? besideOf(placed, r, scene, obstacles) : null
    if (row) {
      placed.splice(placed.indexOf(row.moved), 1, row.other, row.added)
    }
  }
  return placed.map((p) => p.box)
}

/** Every spot a bubble may take, above its speaker or stepped aside, with its tail on the speaker. */
function candidatesOf(
  r: TeamSceneBubbleRequest,
  scene: { width: number; height: number; top?: number },
  placed: readonly Placed[],
  obstacles: readonly TeamSceneRect[]
): Placed[] {
  const preferred = r.align === 'end' ? r.anchor.x - r.width + END_REACH : r.anchor.x - r.width / 2
  const maxLeft = scene.width - r.width - EDGE
  const left = Math.max(EDGE, Math.min(maxLeft, preferred))
  const lefts = [
    left,
    ...obstacles
      .flatMap((o) => [o.left + o.width + GAP, o.left - GAP - r.width])
      .filter((one) => one >= EDGE && one <= maxLeft)
  ]
  const tops = [
    r.anchor.top - r.height - LIFT,
    ...placed.map((p) => p.box.top - r.height - GAP),
    ...obstacles.map((o) => o.top - r.height - GAP)
  ]
  // Why climbing first: a bubble stepped aside stays low and can block the next one's tail.
  return lefts
    .flatMap((at) =>
      tops.map(
        (top): Placed => ({
          box: {
            key: r.key,
            left: at,
            top,
            width: r.width,
            height: r.height,
            tailX: r.anchor.x - at
          },
          anchorTop: r.anchor.top
        })
      )
    )
    .filter(
      (c) =>
        c.box.top >= (scene.top ?? 0) &&
        c.box.tailX >= TAIL_INSET &&
        c.box.tailX <= r.width - TAIL_INSET
    )
}

const clearOf = (
  c: Placed,
  placed: readonly Placed[],
  obstacles: readonly TeamSceneRect[],
  { tailBehindTags = false } = {}
) =>
  placed.every(
    (p) => !overlaps(c.box, p.box) && !tailCrosses(c, p.box) && !tailCrosses(p, c.box)
  ) && obstacles.every((o) => !overlaps(c.box, o) && (tailBehindTags || !tailCrosses(c, o)))

/**
 * With no room to stack, the newcomer and the last bubble share a row, each as near its
 * speaker as the width allows; the tail stays inside its own bubble, clear of the other.
 */
function besideOf(
  placed: Placed[],
  r: TeamSceneBubbleRequest,
  scene: { width: number; top?: number },
  obstacles: readonly TeamSceneRect[]
): { moved: Placed; other: Placed; added: Placed } | null {
  const { width } = scene
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
  // Why: a row that starts above a cropped stage's visible top would be cut under the floor above.
  if (laid.some((one) => one.box.top < (scene.top ?? 0))) {
    return null
  }
  const added = laid.find((one) => one.box.key === r.key)!
  const other = laid.find((one) => one.box.key !== r.key)!
  const rest = placed.filter((p) => p !== moved)
  return clearOf(added, rest, obstacles) && clearOf(other, rest, obstacles)
    ? { moved, other, added }
    : null
}

/** The stretches of a bubble's tail left to draw: the parts that run behind a tag are not. */
export function teamSceneTailRunsOf(
  box: TeamSceneBubbleBox,
  anchorTop: number,
  obstacles: readonly TeamSceneRect[]
): { from: number; to: number }[] {
  const x = box.left + box.tailX
  // Why a px clear each side: the tag is measured where the tail is drawn, a fraction of a px apart.
  const cuts = obstacles
    .filter((o) => x >= o.left - TAIL_CLEAR && x <= o.left + o.width + TAIL_CLEAR)
    .map((o) => ({ from: o.top - TAIL_CLEAR, to: o.top + o.height + TAIL_CLEAR }))
    .sort((a, b) => a.from - b.from)
  const runs: { from: number; to: number }[] = []
  let at = box.top + box.height
  for (const cut of cuts) {
    if (cut.to <= at || cut.from >= anchorTop) {
      continue
    }
    if (cut.from > at) {
      runs.push({ from: at, to: cut.from })
    }
    at = Math.max(at, cut.to)
  }
  if (at < anchorTop) {
    runs.push({ from: at, to: anchorTop })
  }
  return runs
}

/** Whether a square cell of a drawn cloud, in scene px, lies over a tag (touching is not). */
export const teamSceneCellUnder = (
  cell: { x: number; y: number; size: number },
  obstacles: readonly TeamSceneRect[]
): boolean =>
  obstacles.some(
    (o) =>
      cell.x < o.left + o.width &&
      o.left < cell.x + cell.size &&
      cell.y < o.top + o.height &&
      o.top < cell.y + cell.size
  )
