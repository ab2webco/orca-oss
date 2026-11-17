import type { GameMemberSteward, GameStewardPick } from './orchestrator-game-member-steward'
import { gameMemberLaunchOf } from './orchestrator-game-member-launch'

// What a member card says about its Orca steward (ORCA-1242): who picked the model and why, whether
// that follows the lead's plan, and its latest moves. Ids only; each client words them.

export const TEAM_STEWARD_NAME = 'Orca steward'
export const TEAM_STEWARD_STEPS_MAX = 5

/** Why the steward picked or kept the model the card names. */
export type TeamStewardCredit = {
  by: 'steward'
  /** The model before its latest switch; null when it kept it. */
  from: string | null
  /** The moment that decided it (edit, test-loop, plan, judged, …); null before its first decision. */
  reason: string | null
  phase: string | null
  /** A person's /model or Orca's launch pin it leaves alone. */
  kept: 'override' | 'pinned' | null
  /** Haiku could not judge, so it kept the model. */
  failed: boolean
}

export type TeamStewardStep = {
  at: number
  moment: string
  from: string
  to: string
  applied: boolean
}

/** The card detail's steward rows; `plan` is how its latest pick stands against the lead's plan. */
export type TeamSteward = {
  phase: string | null
  plan: 'following' | 'deviated' | 'none'
  steps: TeamStewardStep[]
}

export const teamStewardLabelOf = (model: string): string =>
  gameMemberLaunchOf({ model, effort: null })?.model ?? model

const pickText = (pick: GameStewardPick): string =>
  [teamStewardLabelOf(pick.model), pick.effort].filter(Boolean).join(' · ')

const latestOf = (steward: GameMemberSteward) =>
  steward.decisions.findLast((one) => one.moment !== 'stand-down')

export function teamStewardCreditOf(steward: GameMemberSteward, label: string): TeamStewardCredit {
  const latest = latestOf(steward)
  const before = latest?.applied ? teamStewardLabelOf(latest.from.model) : null
  return {
    by: 'steward',
    from: before && before !== label ? before : null,
    reason: latest?.moment ?? null,
    phase: steward.phase,
    kept: steward.standDown === 'override' ? 'override' : steward.pinned.model ? 'pinned' : null,
    failed: latest?.moment === 'judged' && latest.failure !== undefined
  }
}

/** Following while its latest pick came from the plan; a floor, the kind table or Haiku deviate. */
export function teamStewardOf(steward: GameMemberSteward | undefined): { steward?: TeamSteward } {
  if (!steward) {
    return {}
  }
  const latest = latestOf(steward)
  const isPlanned = !latest || (latest.source === 'plan' && latest.isFloored !== true)
  const steps = steward.decisions
    .filter((one) => one.moment !== 'stand-down')
    .slice(-TEAM_STEWARD_STEPS_MAX)
    .map((one) => ({
      at: one.at,
      moment: one.moment,
      from: pickText(one.from),
      to: pickText(one.to),
      applied: one.applied
    }))
  const plan = steward.plan !== 'plan' ? 'none' : isPlanned ? 'following' : 'deviated'
  return { steward: { phase: steward.phase, plan, steps } }
}

const ENGLISH_MOMENTS: Readonly<Record<string, string>> = {
  edit: 'editing code',
  'test-loop': 'the same test failed twice',
  'pr-ci': 'watching the PR and CI',
  captures: 'taking or reading captures',
  quota: 'a usage window is past 85 %',
  plan: "the lead's plan",
  judged: 'judged by Haiku'
}

/** The steward's credit in English, as the CLI prints it; the renderer words its own. */
export function teamStewardCreditEnglish(credit: TeamStewardCredit): string {
  const name = TEAM_STEWARD_NAME
  if (credit.kept === 'override') {
    return `kept the model you chose (${name})`
  }
  if (credit.kept === 'pinned') {
    return `kept the model pinned at launch (${name})`
  }
  if (credit.failed) {
    return `could not judge, kept the model (${name})`
  }
  const why = credit.reason ? (ENGLISH_MOMENTS[credit.reason] ?? credit.reason) : null
  return why ? `${why} (${name})` : `Chosen by ${name}`
}
