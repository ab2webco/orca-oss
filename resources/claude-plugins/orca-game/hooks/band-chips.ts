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
import { gameStrings, localizedNameOf } from './game-strings'
import { githubLowTextOf } from './github-budget'
import { listActionOf } from './lead-actions'
import { reviewLabelOf } from './rewards'
import type { SceneDefinition } from './scenes/index'

/** A link chip opens `href` when it has one and is drawn in `color`, else the scene's parchment. */
export type BandChip = Chip & {
  isLink?: boolean
  href?: string
  color?: string
  /** Pressing it runs this action instead of opening `href`. */
  actionId?: string
}

export type Counts = { working: number; idle: number; done: number; waiting: number }

/** The Panel's count chips on a phone; waiting takes red only while someone waits. */
export const FLEET_CHIP_COLORS: Readonly<Record<string, string>> = {
  'fleet-working': 'cyan',
  'fleet-idle': 'gray',
  'fleet-done': 'green'
}

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

// Why no href with an action: the project asked for the list through the lead, not a URL.
const withListAction = (state: GameState, list: 'todo' | 'reviews', chip: BandChip): BandChip => {
  const action = listActionOf(state, list)
  if (action === undefined) {
    return chip
  }
  const { href: _href, ...rest } = chip
  return { ...rest, actionId: action.id }
}

// Open PRs drawn one by one before the band falls back to a count.
const BAND_PRS_MAX = 3

// My open PRs, each opening itself, and my tickets, beside the worktree's own review and item.
const projectChipsOf = (state: GameState): BandChip[] => {
  const text = gameStrings().text
  const reviews = state.project?.reviews ?? null
  const todo = state.project?.todo ?? null
  const own = state.review?.url
  const prs = (reviews?.items ?? []).filter((one) => one.url !== own).slice(0, BAND_PRS_MAX)
  const shown = prs.length + ((reviews?.items ?? []).some((one) => one.url === own) ? 1 : 0)
  const tone = reviews === null ? undefined : worstToneOf(reviews)
  const prChips = prs.map(
    (one): BandChip => ({
      key: `band-pr-${one.id}`,
      priority: 3,
      labels: [`⇄ ${one.id}`, one.id],
      href: one.url,
      ...(one.tone === undefined || TONE_COLORS[one.tone] === undefined
        ? {}
        : { color: TONE_COLORS[one.tone] })
    })
  )
  const needsCount = reviews !== null && (reviews.total === 0 || reviews.total > shown)
  const inQa = todo?.groups?.review ?? 0
  const qaChips: BandChip[] =
    todo === null || inQa === 0
      ? []
      : [
          {
            key: 'band-qa',
            priority: 4,
            labels: [`✓ ${text.qa(inQa)}`, `✓ ${inQa}`],
            ...(todo.url === null ? {} : { href: todo.url }),
            color: 'green'
          }
        ]
  return [
    ...prChips,
    ...(needsCount
      ? [
          withListAction(
            state,
            'reviews',
            projectChipOf(
              'band-reviews',
              '⇄',
              text.myReviews(reviewKindOf(reviews), reviews.total),
              reviews,
              tone === undefined ? undefined : TONE_COLORS[tone]
            )
          )
        ]
      : []),
    ...(todo === null
      ? []
      : [
          withListAction(
            state,
            'todo',
            projectChipOf('band-todo', '☐', text.todo(todo.total), todo)
          )
        ]),
    ...qaChips
  ]
}

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

/** Working, idle, done when any, and waiting, full labels first; the marks match the narrow HUD line's. */
export const countChipsOf = (counts: Counts): Chip[] => {
  const text = gameStrings().text
  const done: Chip[] =
    counts.done > 0
      ? [{ key: 'done', priority: 4, labels: [text.done(counts.done), `✓ ${counts.done}`] }]
      : []
  return [
    { key: 'working', priority: 2, labels: [text.working(counts.working), `• ${counts.working}`] },
    { key: 'idle', priority: 4, labels: [text.idle(counts.idle), `z ${counts.idle}`] },
    ...done,
    {
      key: 'waiting',
      priority: counts.waiting > 0 ? 1 : 5,
      labels: [text.waiting(counts.waiting), `! ${counts.waiting}`]
    }
  ]
}

/** The band's status chips, full labels first. */
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
    ...countChipsOf(counts)
  ]
  if (state.githubLow !== undefined) {
    const left = state.githubLow.remaining
    chips.push({
      key: 'band-github-low',
      priority: 1,
      labels: [`! ${githubLowTextOf(left)}`, `! GitHub ${left}`],
      color: 'yellow'
    })
  }
  chips.push(...linkChipsOf(state))
  if (note !== '') {
    chips.push({ key: 'note', priority: 6, labels: [note] })
  }
  if (isLoading) {
    chips.push({ key: 'loading', priority: 7, labels: ['↻'] })
  }
  return chips
}

/** What Pet says: the scene pet's name when it has one, else plain Pet (Clawd, the hero). */
export const petLabelOf = (scene: SceneDefinition): string => {
  const text = gameStrings().text
  const name = scene.cast?.pet?.name
  return `♥ ${name === undefined ? text.pet : text.petNamed(localizedNameOf(name))}`
}

/** The toggle between the scene and the flat text view, naming the one it switches to. */
export const flatToggleLabelsOf = (isFlat: boolean): [string, string] => {
  const text = gameStrings().text
  return isFlat ? [`▦ ${text.sceneView}`, '▦'] : [`≡ ${text.flatView}`, '≡']
}

/** Panel, Refresh, the flat toggle and Pet, which only the scene draws; all but Panel shrink to an icon. */
export const menuChipsOf = (scene: SceneDefinition, isFlat = false): Chip[] => {
  const text = gameStrings().text
  return [
    { key: 'band-panel', priority: 0, labels: [`▤ ${text.panel}`, '▤'] },
    { key: 'band-refresh', priority: 1, labels: [`↻ ${text.refresh}`, '↻'] },
    { key: 'band-flat', priority: 1, labels: flatToggleLabelsOf(isFlat) },
    ...(isFlat ? [] : [{ key: 'band-pet', priority: 2, labels: [petLabelOf(scene), '♥'] as const }])
  ]
}
