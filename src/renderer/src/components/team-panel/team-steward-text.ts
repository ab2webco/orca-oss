import { translate } from '@/i18n/i18n'
import {
  TEAM_STEWARD_NAME,
  type TeamSteward,
  type TeamStewardCache,
  type TeamStewardCredit
} from '../../../../shared/team-panel-steward'
import type { TeamSceneStewardMove } from '../../../../shared/team-scene/team-scene-types'

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
    case 'cold':
      return translate('teamPanel.steward.moment.cold', 'the cache went cold')
    case 'compacted':
      return translate('teamPanel.steward.moment.compacted', 'a compaction rewrote the history')
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

/** Its line beside the member it visits in the scene. */
export function teamStewardVisitText({ lift, to, moment }: TeamSceneStewardMove): string {
  const reason = teamStewardMomentText(moment)
  return lift === 'raise'
    ? translate('teamPanel.steward.raised', 'Up to {{to}}: {{reason}}', { to, reason })
    : translate('teamPanel.steward.lowered', 'Down to {{to}}: {{reason}}', { to, reason })
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

function cacheWhyText(why: string): string {
  switch (why) {
    case 'effort-only':
      return translate('teamPanel.steward.cache.why.effortOnly', 'only the effort changed')
    case 'warm-hold':
      return translate('teamPanel.steward.cache.why.warmHold', 'kept the model, moved only effort')
    case 'cold':
      return translate(
        'teamPanel.steward.cache.why.cold',
        'the cache was cold, so the model switched'
      )
    case 'quota':
      return translate('teamPanel.steward.cache.why.quota', 'a usage window is past 85 %')
    case 'pays-back':
      return translate(
        'teamPanel.steward.cache.why.paysBack',
        'the switch pays for its cache rewrite'
      )
    case 'upward':
      return translate('teamPanel.steward.cache.why.upward', 'the work needed a bigger model')
    default:
      return why
  }
}

/** The member's prompt cache at the steward's latest pick that read it, and why the model stayed or moved (ORCA-1350). */
export function teamStewardCacheText(cache: TeamStewardCache, time: string): string {
  const why = cacheWhyText(cache.why)
  if (!cache.known) {
    return translate(
      'teamPanel.steward.cache.unknown',
      '{{time}} the cache was not read yet, counted warm: {{why}}',
      { time, why }
    )
  }
  const state = cache.warm
    ? translate('teamPanel.steward.cache.warm', 'warm')
    : translate('teamPanel.steward.cache.cold', 'cold')
  const ttl =
    cache.ttl === '1h'
      ? translate('teamPanel.steward.cache.ttl1h', '1 h')
      : translate('teamPanel.steward.cache.ttl5m', '5 min')
  const tokens = `${Math.round(cache.contextTokens / 1000)}k`
  return translate(
    'teamPanel.steward.cache.line',
    '{{time}} the cache was {{state}} · {{ttl}} · {{tokens}} tokens: {{why}}',
    { time, state, ttl, tokens, why }
  )
}
