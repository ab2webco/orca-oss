import React from 'react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

const KIND_LABEL: Record<string, () => string> = {
  question: () => translate('auto.components.game-inbox.GameInboxKindTag.question', 'Question'),
  decision_gate: () =>
    translate('auto.components.game-inbox.GameInboxKindTag.decisionGate', 'Decision'),
  worker_done: () => translate('auto.components.game-inbox.GameInboxKindTag.workerDone', 'Report'),
  escalation: () =>
    translate('auto.components.game-inbox.GameInboxKindTag.escalation', 'Escalation'),
  status: () => translate('auto.components.game-inbox.GameInboxKindTag.status', 'Status'),
  dispatch: () => translate('auto.components.game-inbox.GameInboxKindTag.dispatch', 'Dispatch'),
  merge_ready: () =>
    translate('auto.components.game-inbox.GameInboxKindTag.mergeReady', 'Merge ready'),
  handoff: () => translate('auto.components.game-inbox.GameInboxKindTag.handoff', 'Handoff')
}

// Why a dot, not tinted text: the amber token is too light for text on a light card.
const KIND_DOT: Record<string, string> = {
  question: 'bg-workspace-status-progress',
  decision_gate: 'bg-workspace-status-progress',
  worker_done: 'bg-status-success',
  escalation: 'bg-destructive'
}

/** A message's type as a colored dot and a word; a failure always reads as destructive. */
export function GameInboxKindTag({
  kind,
  failed = false
}: {
  kind: string
  failed?: boolean
}): React.JSX.Element {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          failed ? 'bg-destructive' : (KIND_DOT[kind] ?? 'bg-muted-foreground/50')
        )}
      />
      {KIND_LABEL[kind]?.() ?? kind}
    </span>
  )
}
