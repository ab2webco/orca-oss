import type { GameLinkTone, GameProjectItem } from '../types'
import { cellWidthOf } from './cell-width'
import { fitWords } from './fleet-labels'

const TONE_GLYPHS: Readonly<Record<GameLinkTone, string>> = {
  success: '✓',
  danger: '✗',
  pending: '◐',
  neutral: '·'
}
// The ▶ run mark and the gap after it.
const RUN_CELLS = 2

export type ListTable = {
  idCells: number
  statusCells: number
  rows: { id: string; status: string; title: string }[]
}

/** My PRs and To Do as aligned columns: id, a tone glyph and status, then the title cut at a word. */
export function listTableOf(items: readonly GameProjectItem[], columns: number): ListTable {
  const statusOf = (one: GameProjectItem) =>
    one.status === undefined ? '' : `${TONE_GLYPHS[one.tone ?? 'neutral']} ${one.status}`
  const idCells = Math.max(0, ...items.map((one) => cellWidthOf(one.id)))
  const statusCells = Math.max(0, ...items.map((one) => cellWidthOf(statusOf(one))))
  const fixed = idCells + 1 + (statusCells === 0 ? 0 : statusCells + 1)
  return {
    idCells,
    statusCells,
    rows: items.map((one) => ({
      id: one.id,
      status: statusOf(one),
      title: fitWords(
        one.title,
        Math.max(1, columns - fixed - (one.prompt === undefined ? 0 : RUN_CELLS))
      )
    }))
  }
}
