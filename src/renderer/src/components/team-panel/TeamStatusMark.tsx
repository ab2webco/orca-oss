import { StatusDot } from '@/components/StatusDot'
import type { TeamStatus } from '../../../../shared/team-panel-model-types'
import { teamStatusGlyph, teamStatusTone } from './team-card-text'

/** A card or row's state mark; V28 draws needs-you as a red disc with a `?`. */
export function TeamStatusMark({ status }: { status: TeamStatus }): React.JSX.Element {
  const glyph = teamStatusGlyph(status)
  if (glyph === 'question') {
    return (
      <span
        data-status-glyph="question"
        data-status-tone="attention"
        aria-hidden="true"
        className="inline-grid size-3 shrink-0 place-items-center rounded-full bg-status-attention text-[9px] font-bold leading-none text-white"
      >
        ?
      </span>
    )
  }
  return <StatusDot data-status-glyph={glyph} tone={teamStatusTone(status)} glyph={glyph} />
}
