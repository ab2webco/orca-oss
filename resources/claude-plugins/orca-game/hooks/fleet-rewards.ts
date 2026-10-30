import type { GameAgent, GameMemberWorktree, GameState, RewardWeights } from '../types'
import { gameStrings } from './game-strings'
import { reward, rewardsOf, workRewardsOf, XP_BY_REWARD, type Reward } from './rewards'

type FleetMember = GameAgent & { worktree: GameMemberWorktree }

// Why only members with a worktree: the rest work in the lead's, whose review the pane's own rewards read.
const membersOf = (state: GameState): FleetMember[] =>
  state.role === 'member'
    ? []
    : state.agents.filter(
        (agent): agent is FleetMember => agent.isMember === true && agent.worktree !== undefined
      )

const nameOf = (member: GameAgent): string => member.workItem?.identifier ?? member.displayName

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
  return membersOf(next).flatMap((member): Reward[] => {
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
        ? { ...one, label: `${nameOf(member)} · ${one.label}` }
        : one
    )
  })
}

/** This pane's and its members' rewards at the project's weights; a reward weighted 0 is not written. */
export const earnedRewardsOf = (previous: GameState | null, next: GameState): Reward[] => {
  const weights = next.rewardWeights ?? XP_BY_REWARD
  return [...rewardsOf(previous, next, weights), ...fleetRewardsOf(previous, next, weights)].filter(
    (one) => one.xp !== 0
  )
}
