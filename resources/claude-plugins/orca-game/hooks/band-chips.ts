import type { GameState } from '../types'
import type { Chip } from './chip-rows'
import { reviewShortOf, reviewTextOf, teammatesOf, workItemTextOf } from './fleet-labels'
import { gameStrings } from './game-strings'

export type Counts = { working: number; idle: number; done: number; waiting: number }

export const MENU_ROWS = 1
export const CHIP_ROWS = 2

/** The band's status chips, full labels first; the marks match the narrow HUD line's. */
export const stateChipsOf = (
  state: GameState,
  counts: Counts,
  teammates: number,
  note: string,
  isLoading: boolean
): Chip[] => {
  const text = gameStrings().text
  const chips: Chip[] = [
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
  if (state.review !== null) {
    chips.push({
      key: 'band-review',
      priority: 2,
      labels: [reviewTextOf(state.review), reviewShortOf(state.review)]
    })
  }
  if (state.workItem !== null) {
    chips.push({
      key: 'band-work-item',
      priority: 3,
      labels: [workItemTextOf(state.workItem), state.workItem.identifier]
    })
  }
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
