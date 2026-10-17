import type { GameAgent, GameMemberWorktree, GameState } from '../types'
import { gameStrings } from './game-strings'
import { reward, workRewardsOf, type Reward } from './rewards'

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
export const fleetRewardsOf = (previous: GameState | null, next: GameState): Reward[] => {
  if (previous === null || (previous.worktree?.id ?? '') !== (next.worktree?.id ?? '')) {
    return []
  }
  const before = new Map(membersOf(previous).map((one) => [one.worktree.id, one]))
  return membersOf(next).flatMap((member): Reward[] => {
    const id = member.worktree.id
    const was = before.get(id)
    if (was === undefined) {
      const label = gameStrings().text.memberLaunched(nameOf(member))
      return [reward(`member-claimed:${id}`, 'member-claimed', label)]
    }
    const work = (agent: GameAgent) => ({
      review: agent.review ?? null,
      workItem: agent.workItem ?? null
    })
    return workRewardsOf(work(was), work(member), id).map((one) =>
      one.kind === 'review-merged' || one.kind === 'ci-green'
        ? { ...one, label: `${nameOf(member)} · ${one.label}` }
        : one
    )
  })
}
