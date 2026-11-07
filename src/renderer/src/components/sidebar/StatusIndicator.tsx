import React from 'react'
import { StatusDot, type StatusDotGlyph } from '@/components/StatusDot'
import type { StatusTone } from '@/components/status-tone'
import { getWorktreeStatusLabel, type WorktreeStatus } from '@/lib/worktree-status'

// Why: re-export WorktreeStatus under the existing `Status` alias so the
// sidebar component and the canonical lib share one source of truth — the
// previous local union could silently drift if one side added a new state
// (e.g., 'error') and the other didn't.
export type Status = WorktreeStatus

type StatusIndicatorProps = React.ComponentProps<'span'> & {
  status: Status
}

// Why: 'active' (terminal open, quiet) is idle, not done, so it no longer
// shares the done green; it differs from 'inactive' only by fill.
const PRESENTATION: Record<Status, { tone: StatusTone; glyph: StatusDotGlyph; faded?: boolean }> = {
  working: { tone: 'info', glyph: 'spinner' },
  permission: { tone: 'attention', glyph: 'question' },
  done: { tone: 'success', glyph: 'dot' },
  active: { tone: 'idle', glyph: 'dot' },
  inactive: { tone: 'idle', glyph: 'dot', faded: true }
}

const StatusIndicator = React.memo(function StatusIndicator({
  status,
  title,
  ...rest
}: StatusIndicatorProps) {
  // Why: native tooltip names the state for sighted users; callers pair
  // aria-hidden with an sr-only label, so AT ignores it.
  // Why: an unknown value (stale or newer producer) drew grey before; never crash the row.
  const { tone, glyph, faded } = PRESENTATION[status] ?? PRESENTATION.inactive
  return (
    <StatusDot
      tone={tone}
      glyph={glyph}
      faded={faded}
      size="md"
      title={title ?? getWorktreeStatusLabel(status)}
      {...rest}
    />
  )
})

export default StatusIndicator
