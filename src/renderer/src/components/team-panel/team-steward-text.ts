import { translate } from '@/i18n/i18n'
import {
  TEAM_STEWARD_NAME,
  type TeamSteward,
  type TeamStewardCredit
} from '../../../../shared/team-panel-steward'

// The Orca steward's words on a member card (ORCA-1242); the shared model carries only ids.

const steward = TEAM_STEWARD_NAME

export function teamStewardMomentText(moment: string): string {
  switch (moment) {
    case 'edit':
      return translate('teamPanel.steward.moment.edit', 'editing code')
    case 'high-risk':
      return translate('teamPanel.steward.moment.highRisk', 'editing a high-risk path')
    case 'announce':
      return translate(
        'teamPanel.steward.moment.announce',
        'the plan is approved, implementing next'
      )
    case 'test-loop':
      return translate('teamPanel.steward.moment.testLoop', 'the same test failed twice')
    case 'pr-ci':
      return translate('teamPanel.steward.moment.prCi', 'watching the PR and CI')
    case 'captures':
      return translate('teamPanel.steward.moment.captures', 'taking or reading captures')
    case 'quota':
      return translate('teamPanel.steward.moment.quota', 'a usage window is past 85 %')
    case 'plan':
      return translate('teamPanel.steward.moment.plan', "the lead's plan")
    case 'judged':
      return translate('teamPanel.steward.moment.judged', 'judged by Haiku')
    default:
      return moment
  }
}

/** Why the steward picked or kept the model, as the card's model choice reads it. */
export function teamStewardCreditText(credit: TeamStewardCredit): string {
  if (credit.notServed) {
    return translate(
      'teamPanel.steward.notServed',
      'picked {{model}}, not served: another plugin may skip its hooks ({{steward}})',
      { model: credit.notServed, steward }
    )
  }
  if (credit.kept === 'override') {
    return translate('teamPanel.steward.keptOverride', 'kept the model you chose ({{steward}})', {
      steward
    })
  }
  if (credit.kept === 'pinned') {
    return translate(
      'teamPanel.steward.keptPinned',
      'kept the model pinned at launch ({{steward}})',
      {
        steward
      }
    )
  }
  if (credit.failed) {
    return translate('teamPanel.steward.failed', 'could not judge, kept the model ({{steward}})', {
      steward
    })
  }
  if (!credit.reason) {
    return translate('teamPanel.steward.chosen', 'Chosen by {{steward}}', { steward })
  }
  const reason = teamStewardMomentText(credit.reason)
  return translate('teamPanel.steward.reason', '{{reason}} ({{steward}})', { reason, steward })
}

/** How its latest pick stands against the lead's plan; null without a plan. */
export function teamStewardPlanText(row: TeamSteward): string | null {
  const phase = row.phase ?? '-'
  switch (row.plan) {
    case 'following':
      return translate('teamPanel.steward.following', 'Following the plan · {{phase}}', { phase })
    case 'deviated':
      return translate('teamPanel.steward.deviated', 'Off the plan · {{phase}}', { phase })
    case 'none':
      return null
  }
}

export const teamStewardTimingText = (): string =>
  translate(
    'teamPanel.steward.timing',
    'A new model applies from the next step, a new effort from the next turn.'
  )
