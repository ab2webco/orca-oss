import type { GameLinkTone, GameProjectList, GameState } from '../types'
import type { Chip } from './chip-rows'
import {
  activityLinksOf,
  activityTextOf,
  CI_COLORS,
  ciOfLink,
  ciShortOf,
  linkOfKind,
  projectLabelsOf,
  reviewShortOf,
  reviewStateTextOf,
  reviewTextOf,
  teammatesOf,
  workItemTextOf
} from './fleet-labels'
import { gameStrings } from './game-strings'
import { reviewLabelOf } from './rewards'

/** A link chip opens `href` when it has one and is drawn in `color`, else the scene's parchment. */
export type BandChip = Chip & { isLink?: boolean; href?: string; color?: string }

export type Counts = { working: number; idle: number; done: number; waiting: number }

export const MENU_ROWS = 1
export const CHIP_ROWS = 2

const hrefOf = (url: string): { href?: string } => (url === '' ? {} : { href: url })

const TONE_COLORS: Readonly<Record<GameLinkTone, string | undefined>> = {
  danger: 'red',
  pending: 'yellow',
  success: 'green',
  neutral: undefined
}
const TONE_RANK: readonly GameLinkTone[] = ['danger', 'pending', 'success']

const worstToneOf = (list: GameProjectList): GameLinkTone | undefined =>
  TONE_RANK.find((tone) => list.items.some((one) => one.tone === tone))

/** The review noun after the host: GitLab calls them merge requests. */
export const reviewKindOf = (list: GameProjectList): string =>
  list.provider === 'gitlab' ? 'MR' : 'PR'

// An empty list still says there is nothing pending, after every other link.
const projectChipOf = (
  key: string,
  mark: string,
  text: string,
  list: GameProjectList,
  color?: string
): BandChip => ({
  key,
  priority: list.total > 0 ? 3 : 6,
  labels: [`${mark} ${text}`, `${mark} ${list.total}`],
  ...(list.url === null ? {} : { href: list.url }),
  ...(color === undefined ? {} : { color })
})

// My open PRs and tickets across the project, beside the worktree's own review and item.
const projectChipsOf = (state: GameState): BandChip[] => {
  const text = gameStrings().text
  const reviews = state.project?.reviews ?? null
  const todo = state.project?.todo ?? null
  const tone = reviews === null ? undefined : worstToneOf(reviews)
  return [
    ...(reviews === null
      ? []
      : [
          projectChipOf(
            'band-reviews',
            '⇄',
            text.myReviews(reviewKindOf(reviews), reviews.total),
            reviews,
            tone === undefined ? undefined : TONE_COLORS[tone]
          )
        ]),
    ...(todo === null ? [] : [projectChipOf('band-todo', '☐', text.todo(todo.total), todo)])
  ]
}

// The work item and review lead, then CI, then activity, then the project's own links.
const linkChipsOf = (state: GameState): BandChip[] => {
  const chips: BandChip[] = []
  const ci = linkOfKind(state.links, 'ci')
  if (state.review !== null) {
    chips.push({
      key: 'band-review',
      priority: 2,
      labels:
        ci === undefined
          ? [reviewTextOf(state.review), reviewShortOf(state.review)]
          : [reviewStateTextOf(state.review), reviewLabelOf(state.review)],
      ...hrefOf(state.review.url),
      color: ci === undefined ? CI_COLORS[state.review.ci] : undefined
    })
  }
  if (state.workItem !== null) {
    chips.push({
      key: 'band-work-item',
      priority: 3,
      labels: [workItemTextOf(state.workItem), state.workItem.identifier],
      ...hrefOf(state.workItem.url)
    })
  }
  if (ci !== undefined) {
    const status = ciOfLink(ci)
    chips.push({
      key: 'band-ci',
      priority: 3,
      labels: [`CI ${gameStrings().text.ciWords[status]}`, ciShortOf(status)],
      href: ci.url,
      color: CI_COLORS[status]
    })
  }
  chips.push(...projectChipsOf(state))
  for (const one of activityLinksOf(state)) {
    chips.push({
      key: `band-activity-${one.id}`,
      priority: 4,
      labels: [activityTextOf(one), activityTextOf({ ...one, name: '' })],
      href: one.url,
      color: one.running ? 'cyan' : undefined
    })
  }
  for (const one of state.links.filter((link) => link.kind === 'project')) {
    chips.push({
      key: `band-project-${one.id}`,
      priority: 5,
      labels: projectLabelsOf(one.label),
      href: one.url
    })
  }
  const seen = new Set<string>()
  return chips
    .filter((chip) => !seen.has(chip.key) && seen.add(chip.key))
    .map((chip) => ({ ...chip, isLink: true }))
}

/** The band's status chips, full labels first; the marks match the narrow HUD line's. */
export const stateChipsOf = (
  state: GameState,
  counts: Counts,
  teammates: number,
  note: string,
  isLoading: boolean
): BandChip[] => {
  const text = gameStrings().text
  const chips: BandChip[] = [
    {
      key: 'band-team',
      priority: 0,
      labels: [`⚑ ${teammatesOf(teammates)}`, `⚑ ${text.team} ${teammates}`, `⚑ ${teammates}`]
    },
    { key: 'working', priority: 2, labels: [text.working(counts.working), `• ${counts.working}`] },
    { key: 'idle', priority: 4, labels: [text.idle(counts.idle), `z ${counts.idle}`] }
  ]
  if (counts.done > 0) {
    chips.push({ key: 'done', priority: 4, labels: [text.done(counts.done), `✓ ${counts.done}`] })
  }
  chips.push({
    key: 'waiting',
    priority: counts.waiting > 0 ? 1 : 5,
    labels: [text.waiting(counts.waiting), `! ${counts.waiting}`]
  })
  chips.push(...linkChipsOf(state))
  if (note !== '') {
    chips.push({ key: 'note', priority: 6, labels: [note] })
  }
  if (isLoading) {
    chips.push({ key: 'loading', priority: 7, labels: ['↻'] })
  }
  return chips
}

/** Panel, Refresh and Pet Clawd; the last two keep only their icon when the band is narrow. */
export const menuChipsOf = (): Chip[] => {
  const text = gameStrings().text
  return [
    { key: 'band-panel', priority: 0, labels: [`▤ ${text.panel}`, '▤'] },
    { key: 'band-refresh', priority: 1, labels: [`↻ ${text.refresh}`, '↻'] },
    { key: 'band-pet', priority: 2, labels: [`♥ ${text.petClawd}`, '♥'] }
  ]
}
