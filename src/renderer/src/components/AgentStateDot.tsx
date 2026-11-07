import React from 'react'
import { StatusDot, type StatusDotGlyph } from '@/components/StatusDot'
import type { StatusTone } from '@/components/status-tone'

// Why: agent rows and terminal tabs draw through the shared StatusDot so they
// speak the same colour language as the sidebar. 'done' keeps a check glyph so
// it scans apart from the idle dot in long lists. It sits next to the agent icon
// (Claude/Codex/etc.) — two distinct glyphs: one for *who* (agent icon) and
// one for *what state* (this indicator). Keeping them separate keeps each
// scannable instead of fused into one decorated icon.

export type AgentDotState =
  | 'working'
  | 'blocked'
  | 'waiting'
  | 'interrupted'
  // Why: AI Vault subagent rows report a transcript-derived failure, which is
  // an outcome (like 'done'), not a live attention state like 'blocked'.
  | 'failed'
  | 'done'
  | 'idle'
  // Why: the sidebar's title-based status flow (StatusIndicator/WorktreeCard)
  // collapses blocked + waiting into a single "needs attention" state. Keep
  // this as a distinct member so that flow can render without inventing a new
  // vocabulary, while rendering it with the same question glyph and
  // --agent-question color as the worktree-level permission indicator.
  | 'permission'

/** Return the accessible label shared by every visual agent-state marker. */
export function agentStateLabel(state: AgentDotState): string {
  switch (state) {
    case 'working':
      return 'Working'
    case 'blocked':
      return 'Blocked'
    case 'waiting':
      return 'Waiting for input'
    case 'interrupted':
      return 'Interrupted'
    case 'failed':
      return 'Failed'
    case 'done':
      return 'Done'
    case 'idle':
      return 'Idle'
    case 'permission':
      return 'Needs attention'
  }
}

const PRESENTATION: Record<AgentDotState, { tone: StatusTone; glyph: StatusDotGlyph }> = {
  working: { tone: 'info', glyph: 'spinner' },
  blocked: { tone: 'attention', glyph: 'dot' },
  waiting: { tone: 'attention', glyph: 'question' },
  interrupted: { tone: 'attention', glyph: 'dot' },
  failed: { tone: 'attention', glyph: 'dot' },
  done: { tone: 'success', glyph: 'check' },
  idle: { tone: 'idle', glyph: 'dot' },
  permission: { tone: 'attention', glyph: 'question' }
}

type Props = {
  state: AgentDotState
  size?: 'sm' | 'md'
  className?: string
}

/** Render the compact state glyph used by agent rows and terminal tabs. */
export const AgentStateDot = React.memo(function AgentStateDot({
  state,
  size = 'sm',
  className
}: Props): React.JSX.Element {
  const { tone, glyph } = PRESENTATION[state]
  return (
    <StatusDot
      tone={tone}
      glyph={glyph}
      // Why: idle stays the faded grey it always was; the dashboard has no
      // separate quiet-but-open state.
      faded={state === 'idle'}
      size={size}
      className={className}
      aria-label={agentStateLabel(state)}
    />
  )
})
