import { getIntlLocale, translate } from '@/i18n/i18n'
import type { TeamSteward } from '../../../../shared/team-panel-steward'
import {
  teamStewardCacheText,
  teamStewardMomentText,
  teamStewardPlanText,
  teamStewardTimingText
} from './team-steward-text'

const timeOf = (at: number): string =>
  new Date(at).toLocaleTimeString(getIntlLocale(), { hour: '2-digit', minute: '2-digit' })

/** The steward's plan line and its latest moves, oldest first, in the open member card (ORCA-1242). */
export function TeamStewardSteps({ row }: { row: TeamSteward }): React.JSX.Element {
  const plan = teamStewardPlanText(row)
  const notApplied = translate('teamPanel.steward.notApplied', 'not applied')
  return (
    <div data-team-steward="" className="flex min-w-0 flex-col gap-0.5">
      {plan ? <span data-team-steward-plan={row.plan}>{plan}</span> : null}
      {row.cache ? (
        <span data-team-steward-cache={row.cache.warm ? 'warm' : 'cold'}>
          {teamStewardCacheText(row.cache)}
        </span>
      ) : null}
      {row.steps.length > 0 ? (
        <ol className="flex min-w-0 flex-col gap-0.5 text-muted-foreground">
          {row.steps.map((step) => (
            <li
              key={`${step.at}-${step.moment}`}
              data-team-steward-step={step.moment}
              className="break-words"
            >
              {`${timeOf(step.at)} ${teamStewardMomentText(step.moment)} · ${step.from} → ${step.to}`}
              {step.applied ? '' : ` (${notApplied})`}
            </li>
          ))}
        </ol>
      ) : null}
      <span className="text-muted-foreground">{teamStewardTimingText()}</span>
    </div>
  )
}
