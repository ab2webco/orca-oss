import { gameStrings, localizedNameOf, rasterGlyphsOf } from './game-strings'
import { floatInto, labelInto, sparklesInto, waitingMarksInto, type TeamEvent } from './hd-overlay'
import { LEAD_GOLD, type PlacedMember } from './hd-party'
import { drawThought, thoughtMoodOf } from './hd-thought'
import type { Action } from './quest-policy'
import { paintFinale, reactionSaysOf, snoreOf, type Reaction } from './scene'
import type { AdvisorPose } from './scene-cast'
import type { SceneDefinition } from './scenes/index'

// hd's words: the advisor's cloud, the hero's (or its petted pet's) thought cloud, the waiting `!`,
// sparkles, a floating team reaction, the lead's label and the merge finale.

const ADVISOR_LINE_MAX = 28
/** Columns the hero's cloud keeps before the advisor's may begin, so a narrow band drops the advisor's. */
const HERO_CLOUD_COLUMNS = 18

/** Where a figure stands, in pixels. */
export type Figure = { left: number; top: number; width: number }

export type HdWords = {
  scene: SceneDefinition
  columns: number
  rows: number
  tick: number
  ground: number
  caption: string
  since: number
  isResting: boolean
  isWaiting: boolean
  reaction: Reaction | undefined
  event: TeamEvent | undefined
  action: Action | undefined
  lead: string | undefined
  hero: Figure
  /** Who speaks the thought cloud: the pet while it is petted, else the hero. */
  speaker: Figure
  members: readonly PlacedMember[]
  memberWidth: number
  advisor: AdvisorPose | undefined
}

/** Bands shorter than this have no room above the hero's head, so its cloud floats beside it. */
const CLOUD_ABOVE_MIN_ROWS = 8

export const heroCloudLeftOf = (rows: number, speaker: Figure): number =>
  rows < CLOUD_ABOVE_MIN_ROWS ? speaker.left + speaker.width + 1 : speaker.left + speaker.width - 2

/** Beside the hero, a cloud that would slide back over it is dropped; the caption line still shows it. */
export const heroCloudLeastOf = (rows: number, speaker: Figure): number | undefined =>
  rows < CLOUD_ABOVE_MIN_ROWS ? speaker.left + speaker.width : undefined

export const hdWordsInto = (grid: number[][], w: HdWords): void => {
  const { columns, rows, tick, reaction, event } = w
  const row = rows >= 8 ? 2 : 1
  const isRed = event?.kind === 'fail'
  const mood = thoughtMoodOf({
    caption: w.caption,
    isResting: w.isResting,
    isReacting: reaction !== undefined,
    isWaiting: w.isWaiting,
    isRed,
    isMerging: w.action === 'merge'
  })
  const said =
    reaction !== undefined
      ? reactionSaysOf(reaction.kind)
      : mood === 'idle'
        ? snoreOf(tick)
        : isRed && w.caption === ''
          ? gameStrings().art.ciIsRed
          : w.caption
  const advisorBox =
    w.advisor === undefined || w.advisor.bubble === ''
      ? undefined
      : drawThought(grid, w.advisor.bubble, 'saying', tick - w.advisor.age, {
          columns,
          rows,
          tick,
          left: columns,
          limit: columns,
          row,
          headRight: -1,
          headTop: rows * 2,
          floor: w.ground - 1,
          room: Math.max(4, Math.min(ADVISOR_LINE_MAX, Math.floor(columns / 2) - 4)),
          least: said === '' ? 0 : HERO_CLOUD_COLUMNS
        })
  const since = reaction !== undefined ? tick - reaction.age : isRed ? tick - event.age : w.since
  const box = drawThought(grid, said, mood, since, {
    columns,
    rows,
    tick,
    left: heroCloudLeftOf(rows, w.speaker),
    limit: advisorBox === undefined ? columns : advisorBox.left - 3,
    row,
    headRight: w.speaker.left + w.speaker.width - 1,
    headTop: w.speaker.top,
    floor: w.ground - 1,
    least: heroCloudLeastOf(rows, w.speaker)
  })
  const clouds = [box, advisorBox]
  waitingMarksInto(grid, columns, w.members, w.memberWidth, tick, clouds)
  sparklesInto(grid, columns, box?.row ?? 1, w.speaker.left, w.speaker.width, reaction, clouds)
  if (event !== undefined) {
    const centre = w.hero.left + Math.floor(w.hero.width / 2)
    floatInto(grid, columns, event, Math.max(0, Math.floor(w.hero.top / 2)), centre, clouds)
  }
  if (w.lead !== undefined) {
    labelInto(grid, columns, rows - 1, w.hero.left + w.hero.width / 2, w.lead, LEAD_GOLD)
  }
  if (w.action === 'merge' && w.scene.finale !== undefined) {
    paintFinale(grid, columns, rasterGlyphsOf(localizedNameOf(w.scene.finale)).join(''), rows)
  }
}
