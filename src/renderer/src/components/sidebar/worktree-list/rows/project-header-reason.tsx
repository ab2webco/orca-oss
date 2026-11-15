import React from 'react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { StatusDot } from '@/components/StatusDot'
import type { StatusDotGlyph } from '@/components/StatusDot'
import type { StatusTone } from '@/components/status-tone'
import type { ProjectUrgencyReason } from '../grouping/project-urgency-tier'

type ReasonLook = { tone: StatusTone; glyph: StatusDotGlyph; textClass: string; text: string }

function reasonLook(reason: ProjectUrgencyReason): ReasonLook {
  switch (reason.kind) {
    case 'questions':
      return {
        tone: 'attention',
        glyph: 'dot',
        textClass: 'text-status-attention',
        text: translate(
          'auto.components.sidebar.ProjectHeaderReason.questions',
          '{{count}} questions',
          {
            count: reason.count
          }
        )
      }
    case 'account-limit':
      return {
        tone: 'attention',
        glyph: 'dot',
        textClass: 'text-status-attention',
        text: translate(
          'auto.components.sidebar.ProjectHeaderReason.accountLimited',
          'Account limited'
        )
      }
    case 'ci-failing':
      return {
        tone: 'warning',
        glyph: 'dot',
        textClass: 'text-status-warning',
        text: translate('auto.components.sidebar.ProjectHeaderReason.ciFailing', 'CI failing')
      }
    case 'working':
      return {
        tone: 'info',
        glyph: 'spinner',
        // Why muted: §4 draws the spinner alone in --status-info; the count reads as metadata.
        textClass: 'text-muted-foreground',
        text: translate(
          'auto.components.sidebar.ProjectHeaderReason.working',
          '{{count}} working',
          {
            count: reason.count
          }
        )
      }
  }
}

/** A project header's tier, said in words (ORCA-1216 §4); it takes the age's place. */
export const ProjectHeaderReason = React.memo(function ProjectHeaderReason({
  reason
}: {
  reason: ProjectUrgencyReason
}): React.JSX.Element {
  const look = reasonLook(reason)
  return (
    <span
      data-project-reason={reason.kind}
      className="flex shrink-0 items-center gap-1.5 text-[11px] leading-none"
    >
      <StatusDot tone={look.tone} glyph={look.glyph} size="md" />
      <span data-project-reason-text="" className={cn('whitespace-nowrap', look.textClass)}>
        {look.text}
      </span>
    </span>
  )
})
