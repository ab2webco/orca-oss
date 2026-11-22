import { GAME_ROWS, type GameRowGroup, type GameRowId } from './orchestrator-game-row-visibility'

export type GameRowDrawers = Partial<Record<GameRowId, () => React.ReactNode>>

/** One group's shown rows in the table's order, or nothing when none shows (no empty heading). */
export function GameRowGroupView({
  group,
  shown,
  draw,
  heading,
  label,
  className = 'space-y-1'
}: {
  group: GameRowGroup
  shown: ReadonlySet<GameRowId>
  /** A row with no drawer belongs to another page. */
  draw: GameRowDrawers
  heading?: React.ReactNode
  /** Names the group for assistive tech; set where the group has its own heading. */
  label?: string
  className?: string
}): React.JSX.Element | null {
  const rows = GAME_ROWS.filter(
    (row) => row.group === group && shown.has(row.id) && draw[row.id] !== undefined
  )
  if (rows.length === 0) {
    return null
  }
  return (
    <div
      data-game-group={group}
      role={label === undefined ? undefined : 'group'}
      aria-label={label}
      className={className}
    >
      {heading}
      {rows.map((row) => (
        <div key={row.id} data-game-row={row.id}>
          {draw[row.id]?.()}
        </div>
      ))}
    </div>
  )
}
