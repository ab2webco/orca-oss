import { StatusDot } from '@/components/StatusDot'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import CacheTimer from '../sidebar/CacheTimer'
import type { TeamActivityRow, TeamAdvisorRow } from '../../../../shared/team-panel-model-types'
import {
  teamCiText,
  teamLiveText,
  teamModelText,
  teamPrNumberText,
  teamSessionStateText,
  teamStatusTone
} from './team-card-text'
import { TeamHostName } from './TeamHostName'
import { teamAdvisorSourceText } from './TeamTabContent'

function Fact({
  label,
  value,
  attention = false
}: {
  label: string
  value: React.ReactNode
  attention?: boolean
}): React.JSX.Element | null {
  if (value === null || value === '') {
    return null
  }
  return (
    <>
      <dt className="text-muted-foreground/80">{label}</dt>
      <dd
        className={cn('m-0 min-w-0 [overflow-wrap:anywhere]', attention && 'text-status-attention')}
      >
        {value}
      </dd>
    </>
  )
}

function pinText(pinned: TeamAdvisorRow['pinned']): string | null {
  if (pinned.model) {
    return translate('teamPanel.activity.modelPinned', 'Model pinned')
  }
  return pinned.effort ? translate('teamPanel.activity.effortPinned', 'Effort pinned') : null
}

function AdvisorFacts({ advisor }: { advisor: TeamAdvisorRow }): React.JSX.Element | null {
  const model = [advisor.model, pinText(advisor.pinned)].filter(Boolean).join(' · ')
  const change =
    advisor.previous?.model && advisor.previous.model !== advisor.model
      ? `${advisor.previous.model} → ${advisor.model ?? ''}`
      : null
  if (!model && !change && advisor.calls.length === 0) {
    return null
  }
  return (
    <section data-team-activity-advisor="" className="mt-3">
      <h4 className="mb-1 text-[11.5px] font-medium text-muted-foreground/80">
        {teamAdvisorSourceText()}
      </h4>
      <dl className="grid grid-cols-[62px_minmax(0,1fr)] gap-x-2.5 gap-y-1 text-xs">
        <Fact label={translate('teamPanel.activity.model', 'Model')} value={model} />
        <Fact label={translate('teamPanel.activity.change', 'Change')} value={change} />
        {advisor.calls.map((call) => (
          <Fact
            key={`${call.agent}:${call.model ?? ''}:${call.verdict}`}
            label={call.agent}
            value={call.model ? `${call.model} · ${call.verdict}` : call.verdict}
          />
        ))}
      </dl>
    </section>
  )
}

/** The selected session in full; the panel shows it, so hover cards stay off here. */
export function TeamActivityDetail({
  row,
  now,
  cacheTtlMs
}: {
  row: TeamActivityRow
  now: number
  cacheTtlMs: number
}): React.JSX.Element {
  const question = row.liveAction?.kind === 'question' ? row.liveAction.text : null
  const doing =
    row.liveAction && row.liveAction.kind !== 'question'
      ? teamLiveText(row.liveAction, row.condition)
      : null
  const pr = row.pr
    ? [teamPrNumberText(row.pr), teamCiText(row.pr)].filter(Boolean).join(' · ')
    : null
  return (
    <section data-team-activity="selected" data-pane-key={row.paneKey} className="px-3 pb-3 pt-2.5">
      <div className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
        <span className="max-w-[70%] shrink-0 truncate text-[13px] font-semibold">
          {row.worktreeName}
        </span>
        {row.repoName ? (
          <span className="truncate text-xs text-muted-foreground">{row.repoName}</span>
        ) : null}
        <code className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
          <TeamHostName host={row.host} />
        </code>
      </div>
      <div className="mb-2.5 mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <StatusDot tone={teamStatusTone(row.status)} />
        <span className={cn(row.status === 'attention' && 'text-status-attention')}>
          {teamSessionStateText(row.condition)}
          {row.since !== null ? ` · ${formatUiRelativeTime(row.since - now)}` : ''}
        </span>
      </div>
      <dl className="grid grid-cols-[62px_minmax(0,1fr)] gap-x-2.5 gap-y-1 text-xs">
        <Fact label={translate('teamPanel.activity.prompt', 'Prompt')} value={row.prompt} />
        <Fact label={translate('teamPanel.activity.now', 'Now')} value={doing} />
        <Fact
          label={translate('teamPanel.activity.question', 'Question')}
          value={question}
          attention
        />
        <Fact
          label={translate('teamPanel.activity.last', 'Final')}
          value={row.condition === 'done' || row.condition === 'idle' ? row.lastMessage : null}
        />
        <Fact
          label={translate('teamPanel.activity.model', 'Model')}
          value={teamModelText(row.model)}
        />
        <Fact
          label={translate('teamPanel.activity.account', 'Account')}
          value={row.account?.email ?? null}
        />
        <Fact
          label={translate('teamPanel.activity.cache', 'Cache')}
          value={
            row.cacheExpiresAt !== null && cacheTtlMs > 0 ? (
              <CacheTimer startedAt={row.cacheExpiresAt - cacheTtlMs} ttlMs={cacheTtlMs} />
            ) : null
          }
        />
        <Fact
          label={translate('teamPanel.activity.pr', 'PR')}
          value={
            row.pr && pr ? (
              <a href={row.pr.url} target="_blank" rel="noreferrer" className="hover:underline">
                {pr}
              </a>
            ) : null
          }
        />
        <Fact
          label={translate('teamPanel.activity.ticket', 'Ticket')}
          value={row.ticket?.identifier ?? null}
        />
        <Fact
          label={translate('teamPanel.activity.ports', 'Ports')}
          value={row.ports.length > 0 ? row.ports.join(', ') : null}
        />
        <Fact label={translate('teamPanel.activity.notes', 'Notes')} value={row.note} />
      </dl>
      {row.advisor ? <AdvisorFacts advisor={row.advisor} /> : null}
      {/* Why no History: AgentStatusEntry keeps no tool steps yet (ORCA-1049 gap). */}
    </section>
  )
}
