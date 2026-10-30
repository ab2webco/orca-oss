import type { GameAgent, GameMemberWorktree, GameMerge, GameState, RewardWeights } from '../types'
import { gameStrings } from './game-strings'
import {
  reviewLabelOf,
  reward,
  rewardsOf,
  workRewardsOf,
  XP_BY_REWARD,
  type Reward
} from './rewards'

type FleetMember = GameAgent & { worktree: GameMemberWorktree }

// Why only members with a worktree: the rest work in the lead's, whose review the pane's own rewards read.
const membersOf = (state: GameState): FleetMember[] =>
  state.role === 'member'
    ? []
    : state.agents.filter(
        (agent): agent is FleetMember => agent.isMember === true && agent.worktree !== undefined
      )

const nameOf = (member: GameAgent): string => member.workItem?.identifier ?? member.displayName

const withName = (name: string, one: Reward): Reward => ({
  ...one,
  label: `${name} · ${one.label}`
})

// Why the same ids as a member's review moving to merged: a merge both seen and recorded earns once.
const recordedMergeRewardsOf = (merge: GameMerge, weights: RewardWeights): Reward[] => {
  const label = reviewLabelOf(merge)
  const key = `${merge.provider}${label}@${merge.worktreeId}`
  const name = merge.ticket ?? label
  const text = gameStrings().text
  const merged = reward(`review-merged:${key}`, 'review-merged', text.merged(label), weights)
  const perfect = reward(`perfect-merge:${key}`, 'perfect-merge', text.perfectMerge(label), weights)
  return (merge.perfect ? [merged, perfect] : [merged]).map((one) => ({
    ...withName(name, one),
    review: label
  }))
}

// Why only against a list the previous poll had: an older host's state, or the first poll, holds
// merges no pane saw happen, which must not all pay out at once.
const newMergesOf = (previous: GameState, next: GameState): GameMerge[] => {
  if (previous.merges === undefined || next.role === 'member') {
    return []
  }
  const seen = new Set(previous.merges.map((one) => one.key))
  return (next.merges ?? []).filter((one) => !seen.has(one.key))
}

/** What a lead's launched members earned it between two polls; a member pane earns only its own. */
export const fleetRewardsOf = (
  previous: GameState | null,
  next: GameState,
  weights: RewardWeights = XP_BY_REWARD
): Reward[] => {
  if (previous === null || (previous.worktree?.id ?? '') !== (next.worktree?.id ?? '')) {
    return []
  }
  const before = new Map(membersOf(previous).map((one) => [one.worktree.id, one]))
  const seen = membersOf(next).flatMap((member): Reward[] => {
    const id = member.worktree.id
    const was = before.get(id)
    if (was === undefined) {
      const label = gameStrings().text.memberLaunched(nameOf(member))
      return [reward(`member-claimed:${id}`, 'member-claimed', label, weights)]
    }
    const work = (agent: GameAgent) => ({
      review: agent.review ?? null,
      workItem: agent.workItem ?? null
    })
    return workRewardsOf(work(was), work(member), id, weights).map((one) =>
      one.kind === 'review-merged' || one.kind === 'perfect-merge' || one.kind === 'ci-green'
        ? withName(nameOf(member), one)
        : one
    )
  })
  // ORCA-887: the lead or auto-release frees a member right after its merge, before a poll sees it.
  const recorded = newMergesOf(previous, next).flatMap((one) =>
    recordedMergeRewardsOf(one, weights)
  )
  const ids = new Set(seen.map((one) => one.id))
  return [...seen, ...recorded.filter((one) => !ids.has(one.id))]
}

/** This pane's and its members' rewards at the project's weights; a reward weighted 0 is not written. */
export const earnedRewardsOf = (previous: GameState | null, next: GameState): Reward[] => {
  const weights = next.rewardWeights ?? XP_BY_REWARD
  return [...rewardsOf(previous, next, weights), ...fleetRewardsOf(previous, next, weights)].filter(
    (one) => one.xp !== 0
  )
}
