import type { ReactNode } from 'react'
import { StatusDot } from '@/components/StatusDot'
import { formatUsagePercentageLabel } from '@/components/status-bar/usage-percentage-label'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { accountLimitsOf } from '../../../../shared/orchestrator-game-member-limit'
import { formatResetDuration } from '../../../../shared/rate-limit-reset-format'
import type { TeamAccount, TeamMemberCard } from '../../../../shared/team-panel-model-types'
import {
  clampUsedPercent,
  getDisplayedUsagePercentage,
  normalizeUsagePercentageDisplay,
  type UsagePercentageDisplay
} from '../../../../shared/usage-percentage-display'
import {
  statusToneOfCi,
  teamAgeText,
  teamCiText,
  teamHostText,
  teamLiveText,
  teamModelText,
  teamPhaseText,
  teamPrNumberText,
  teamUsageBarClass
} from './team-card-text'
import { teamAccountWindowsOf } from './team-account-usage'

type Fact = { key: string; label: string; value: string; mono?: boolean }

function factsOf(card: TeamMemberCard, now: number): Fact[] {
  const model = teamModelText(card.model)
  const step = [
    card.flowPhase ? teamPhaseText(card.flowPhase) : null,
    teamLiveText(card.liveAction, card.condition)
  ]
    .filter(Boolean)
    .join(' · ')
  const facts: (Fact | null)[] = [
    card.branch
      ? {
          key: 'branch',
          label: translate('teamPanel.card.detail.branch', 'Branch'),
          value: card.branch,
          mono: true
        }
      : null,
    model
      ? {
          key: 'model',
          label: translate('teamPanel.card.detail.model', 'Model'),
          value: model,
          mono: true
        }
      : null,
    step
      ? { key: 'step', label: translate('teamPanel.card.detail.step', 'Step'), value: step }
      : null,
    card.since !== null
      ? {
          key: 'since',
          label: translate('teamPanel.card.detail.since', 'In state'),
          value: teamAgeText(card.since, now)
        }
      : null,
    {
      key: 'host',
      label: translate('teamPanel.card.detail.host', 'Host'),
      value: teamHostText(card.host),
      mono: true
    }
  ]
  return facts.filter((fact): fact is Fact => fact !== null)
}

function UsageBar({
  window,
  label,
  used,
  resetsAt,
  now,
  display
}: {
  window: 'session' | 'weekly'
  label: string
  used: number
  resetsAt: number | null | undefined
  now: number
  display: UsagePercentageDisplay
}): React.JSX.Element {
  const clamped = clampUsedPercent(used)
  const left = resetsAt != null ? formatResetDuration(resetsAt - now) : null
  return (
    <div data-team-usage={window} className="flex min-w-0 items-center gap-2">
      <span className="w-9 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-[4px] min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        {/* Why: fill follows the chosen percentage; the colour still signals how much is used. */}
        <div
          data-team-usage-fill=""
          className={`h-full rounded-full ${teamUsageBarClass(clamped)}`}
          style={{ width: `${getDisplayedUsagePercentage(clamped, display)}%` }}
        />
      </div>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {formatUsagePercentageLabel(clamped, display)}
        {left ? ` · ${left}` : ''}
      </span>
    </div>
  )
}

function AccountUsage({ account, now }: { account: TeamAccount; now: number }): React.JSX.Element {
  const display = normalizeUsagePercentageDisplay(
    useAppStore((state) => state.usagePercentageDisplay)
  )
  // Why the host's own reading: the status bar shows it, and game.state has no reset times.
  const limits = useAppStore((state) => {
    if (!account.id) {
      return null
    }
    const settings = state.settings
    const active =
      account.provider === 'claude'
        ? (settings?.activeClaudeManagedAccountIdsByRuntime?.host ??
          settings?.activeClaudeManagedAccountId ??
          null)
        : (settings?.activeCodexManagedAccountIdsByRuntime?.host ??
          settings?.activeCodexManagedAccountId ??
          null)
    return accountLimitsOf(state.rateLimits, account.provider, account.id, active)
  })
  const { session, weekly } = teamAccountWindowsOf(account, limits)
  return (
    <div data-team-account="" className="flex min-w-0 flex-col gap-1">
      <span className="truncate text-muted-foreground">{account.email}</span>
      {session ? (
        <UsageBar
          window="session"
          label={translate('teamPanel.card.usage.session', '5 h')}
          used={session.usedPercent}
          resetsAt={session.resetsAt}
          now={now}
          display={display}
        />
      ) : null}
      {weekly ? (
        <UsageBar
          window="weekly"
          label={translate('teamPanel.card.usage.weekly', 'Week')}
          used={weekly.usedPercent}
          resetsAt={weekly.resetsAt}
          now={now}
          display={display}
        />
      ) : null}
    </div>
  )
}

/** The open member card, as V30's `.more`: title, a facts grid, the PR chip and account bars. */
export function TeamMemberCardDetail({
  card,
  now,
  answer
}: {
  card: TeamMemberCard
  now: number
  answer: ReactNode
}): React.JSX.Element {
  // Why not the summary: it is the last message's subject ("Re: Question"); the text is in Inbox.
  const title = card.ticket?.title ?? card.pr?.title ?? null
  const ci = card.pr ? teamCiText(card.pr) : null
  const ciTone = card.pr ? statusToneOfCi(card.pr) : null
  return (
    <div
      data-team-card-detail=""
      className="flex min-w-0 flex-col gap-2.5 bg-sidebar-accent px-3 pb-3 pt-1 text-xs"
    >
      {answer}
      {title ? (
        <p data-team-card-title="" className="break-words text-[13px] font-medium text-foreground">
          {title}
        </p>
      ) : null}
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {factsOf(card, now).map((fact) => (
          <div key={fact.key} data-team-detail={fact.key} className="contents">
            <dt className="text-muted-foreground">{fact.label}</dt>
            <dd className="min-w-0 truncate text-foreground">
              {fact.mono ? (
                <code className="font-mono text-[11.5px]">{fact.value}</code>
              ) : (
                fact.value
              )}
            </dd>
          </div>
        ))}
      </dl>
      {card.pr ? (
        <a
          data-team-pr-chip=""
          href={card.pr.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-max max-w-full items-center gap-1.5 rounded-md bg-sidebar px-2 py-0.5 text-foreground hover:bg-sidebar-border"
        >
          {ciTone ? <StatusDot tone={ciTone} /> : null}
          <span className="truncate">{`${teamPrNumberText(card.pr)}${ci ? ` · ${ci}` : ''}`}</span>
        </a>
      ) : null}
      {card.account ? <AccountUsage account={card.account} now={now} /> : null}
    </div>
  )
}
