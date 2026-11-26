import type { ReactNode } from 'react'
import { StatusDot } from '@/components/StatusDot'
import { formatUsagePercentageLabel } from '@/components/status-bar/usage-percentage-label'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
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
  teamBranchParts,
  teamCiText,
  teamHelperStateText,
  teamLiveText,
  teamModelCreditText,
  teamPrNumberText,
  teamUsageBarClass
} from './team-card-text'
import { teamAccountWindowsOf } from './team-account-usage'
import { teamHelpersOf } from './team-member-helpers'
import { TeamStewardSteps } from './TeamStewardSteps'

/** One line per helper (subagent) in the member's session, from the pane's live roster. */
function HelpersList({ paneKey }: { paneKey: string }): React.JSX.Element | null {
  const subagents = useAppStore((state) => state.agentStatusByPaneKey[paneKey]?.subagents)
  const { helpers } = teamHelpersOf(subagents)
  if (helpers.length === 0) {
    return null
  }
  return (
    <ul data-team-helpers-list="" className="flex min-w-0 flex-col gap-1">
      {helpers.map((helper) => (
        <li key={helper.id} data-team-helper="" className="flex min-w-0 justify-between gap-3">
          <span className="min-w-0 break-words text-foreground">{helper.label}</span>
          <span
            className={
              helper.state === 'working'
                ? 'shrink-0 text-status-info'
                : 'shrink-0 text-muted-foreground'
            }
          >
            {teamHelperStateText(helper.state)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** `wraps`: a sentence that must read whole at 320, where a path or tool may be cut. */
export type TeamFact = { key: string; label: string; value: ReactNode; wraps?: true }

/** A branch cut in the middle: the owner prefix gives way first, the ticket part stays whole. */
export function BranchText({ branch }: { branch: string }): React.JSX.Element {
  const { head, tail } = teamBranchParts(branch)
  return (
    <code title={branch} className="flex min-w-0 font-mono text-[11.5px]">
      {head ? <span className="min-w-0 shrink-[100] truncate">{head}</span> : null}
      <span className="min-w-0 truncate">{tail}</span>
    </code>
  )
}

// Why only these: the header above already shows model, phase, time in state and host (owner).
function factsOf(card: TeamMemberCard): TeamFact[] {
  const tool =
    card.liveAction && card.liveAction.kind !== 'question'
      ? teamLiveText(card.liveAction, card.condition)
      : null
  const credit = teamModelCreditText(card.model)
  const facts: (TeamFact | null)[] = [
    card.branch
      ? {
          key: 'branch',
          label: translate('teamPanel.card.detail.branch', 'Branch'),
          value: <BranchText branch={card.branch} />
        }
      : null,
    tool
      ? { key: 'tool', label: translate('teamPanel.card.detail.tool', 'Last tool'), value: tool }
      : null,
    credit
      ? {
          key: 'modelChoice',
          label: translate('teamPanel.card.detail.modelChoice', 'Model choice'),
          value: credit,
          wraps: true as const
        }
      : null,
    card.steward
      ? {
          key: 'steward',
          label: translate('teamPanel.card.detail.steward', 'Steward'),
          value: <TeamStewardSteps row={card.steward} />,
          wraps: true as const
        }
      : null
  ]
  return facts.filter((fact): fact is TeamFact => fact !== null)
}

/** Label and value pairs; needs an `@container` ancestor to stack when narrow. */
export function TeamFactsGrid({ facts }: { facts: TeamFact[] }): React.JSX.Element {
  return (
    // Why stacked when narrow: beside a full label the value column is narrower than one word.
    <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 @max-[16rem]:grid-cols-1 @max-[16rem]:gap-y-0">
      {facts.map((fact, index) => (
        <div key={fact.key} data-team-detail={fact.key} className="contents">
          <dt className={cn('text-muted-foreground', index > 0 && '@max-[16rem]:mt-1.5')}>
            {fact.label}
          </dt>
          <dd className={`min-w-0 text-foreground ${fact.wraps ? 'break-words' : 'truncate'}`}>
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  )
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
  const tone = teamUsageBarClass(clamped)
  const left = resetsAt != null ? formatResetDuration(resetsAt - now) : null
  return (
    <div data-team-usage={window} className="contents">
      <span className="text-muted-foreground">{label}</span>
      <div
        data-team-usage-track=""
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        aria-valuetext={formatUsagePercentageLabel(clamped, display)}
        className={`h-1 min-w-0 overflow-hidden rounded-full ${tone.track}`}
      >
        {/* Why: fill follows the chosen percentage; the colour still signals how much is used. */}
        <div
          data-team-usage-fill=""
          className={`h-full rounded-full ${tone.fill}`}
          style={{ width: `${getDisplayedUsagePercentage(clamped, display)}%` }}
        />
      </div>
      <span className="text-right tabular-nums text-muted-foreground">
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
    <div data-team-account="" className="flex min-w-0 flex-col gap-1.5">
      <span data-team-account-label="" className="truncate text-muted-foreground">
        {`${account.provider === 'codex' ? translate('teamPanel.card.usage.codex', 'Codex') : translate('teamPanel.card.usage.claude', 'Claude')} · ${account.email}`}
      </span>
      <div
        data-team-usage-grid=""
        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5"
      >
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
    </div>
  )
}

/** The open member card, as V30's `.more`: title, a facts grid, the PR chip and account bars. */
export function TeamMemberCardDetail({
  card,
  now,
  answer,
  hostWorktreeMissing = false,
  remove = null
}: {
  card: TeamMemberCard
  now: number
  answer: ReactNode
  hostWorktreeMissing?: boolean
  /** The card's Remove action, last so it never sits where Open or a PR is reached for. */
  remove?: ReactNode
}): React.JSX.Element {
  // Why not the summary: it is the last message's subject ("Re: Question"); the text is in Inbox.
  const title = card.ticket?.title ?? card.pr?.title ?? null
  const ci = card.pr ? teamCiText(card.pr) : null
  const ciTone = card.pr ? statusToneOfCi(card.pr) : null
  return (
    <div
      data-team-card-detail=""
      className="@container flex min-w-0 flex-col gap-2.5 px-3 pb-3 pt-1 text-xs"
    >
      {answer}
      {title ? (
        <p data-team-card-title="" className="break-words text-[13px] font-medium text-foreground">
          {title}
        </p>
      ) : null}
      <TeamFactsGrid facts={factsOf(card)} />
      {hostWorktreeMissing ? (
        <p data-team-card-host-hint="" className="break-words text-muted-foreground">
          {translate(
            'teamPanel.card.detail.hostWorktreeMissing',
            "Add the host's repository to this window to open its terminal."
          )}
        </p>
      ) : null}
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
      <HelpersList paneKey={card.paneKey} />
      {card.account ? <AccountUsage account={card.account} now={now} /> : null}
      {remove}
    </div>
  )
}
