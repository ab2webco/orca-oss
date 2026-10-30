import type { GameAgent, GameState } from '../types'
import type { HudMember } from './fleet-hud'
import { linkOfKind } from './fleet-labels'
import { gameStrings } from './game-strings'
import { leadStateOf } from './lead-state'
import { limitTagOf } from './member-tags'
import type { MemberState, Mood } from './party-sprites'
import { actionOf, activityOf, phaseOf, type FlowPhase } from './quest-policy'
import { isCiRed, reviewLabelOf } from './rewards'
import type { ScenePhase } from './scenes/index'

export type PartyMember = HudMember & { key: string; isDone: boolean }

export type Need = { name: string; text: string; url: string | null }

const FLOW_ORDER: readonly ScenePhase[] = ['working', 'docs', 'build', 'verify', 'pr', 'handoff']

type Work = Pick<GameState, 'review' | 'workItem'>

// A member in its own worktree is read by that worktree's PR and ticket, the rest by the lead's.
const workOf = (agent: GameAgent, state: GameState): Work =>
  agent.worktree ? { review: agent.review ?? null, workItem: agent.workItem ?? null } : state

export const worktreePhaseOf = (state: Work): FlowPhase | undefined => {
  const group = state.workItem?.statusGroup
  if (state.review?.state === 'merged' || group === 'review' || group === 'done') {
    return 'handoff'
  }
  return state.review?.state === 'open' || state.review?.state === 'draft' ? 'pr' : undefined
}

const isFinished = (state: Work): boolean =>
  state.review?.state === 'merged' || state.workItem?.statusGroup === 'done'

const memberStateOf = (agent: GameAgent): MemberState =>
  agent.state === 'done' ? 'idle' : agent.state

const moodOf = (agent: GameAgent, state: Work, hasRewards: boolean): Mood => {
  const isDone = agent.state === 'done'
  if (!isDone && isCiRed(state.review)) {
    return 'hurt'
  }
  return hasRewards && (isDone || isFinished(state)) ? 'cheer' : 'none'
}

const saysOf = (agent: GameAgent): string => {
  const says = gameStrings().art.says
  if (agent.state === 'done' || agent.state === 'idle') {
    return says[agent.state]
  }
  const tool = agent.toolName ?? ''
  return tool === '' ? says[agent.state] : (activityOf(tool, {}).split(' ')[0] ?? tool)
}

// A lead still at work never rests: no finished costume, and no cheer, which the sprites draw asleep.
const awakeLeadOf = (agent: GameAgent, state: GameState): PartyMember | undefined => {
  const lead = agent.isLeader ? leadStateOf(state) : undefined
  if (lead === undefined || lead === 'sleeping') {
    return undefined
  }
  const tool = lead === 'working' ? (agent.toolName ?? '') : ''
  const shared = worktreePhaseOf(state)
  return {
    key: agent.paneKey,
    name: agent.displayName,
    phase: phaseOf(tool, {}) ?? (shared === 'handoff' ? undefined : shared) ?? 'working',
    state: lead === 'waiting' ? 'waiting' : 'working',
    mood: isCiRed(state.review) ? 'hurt' : 'none',
    action: lead === 'working' ? actionOf(tool, {}) : undefined,
    says: lead === 'orchestrating' ? gameStrings().text.agentStates.orchestrating : saysOf(agent),
    isDone: false
  }
}

export const memberOf = (agent: GameAgent, state: GameState, hasRewards: boolean): PartyMember => {
  const awake = awakeLeadOf(agent, state)
  if (awake !== undefined) {
    return awake
  }
  const tool = agent.toolName ?? ''
  const isDone = agent.state === 'done'
  const work = workOf(agent, state)
  const shared = worktreePhaseOf(work)
  return {
    key: agent.paneKey,
    name: agent.displayName,
    phase: isDone ? 'handoff' : (phaseOf(tool, {}) ?? shared ?? 'working'),
    state: memberStateOf(agent),
    mood: moodOf(agent, work, hasRewards),
    action: agent.state === 'working' ? actionOf(tool, {}) : undefined,
    says: saysOf(agent),
    isDone
  }
}

/** A remote member whose host does not answer, or whose terminal is gone before it finished. */
export const isGhostOf = (agent: GameAgent): boolean => {
  const { remote } = agent
  if (remote === undefined) {
    return false
  }
  // Why gone first: an older Orca also sends `stateKnown: false` with it, though the host answered.
  return remote.gone === true ? agent.state !== 'done' : !remote.stateKnown
}

// Needs-you, working, idle, done; a ghost after all of them.
const rankOf = (agent: GameAgent, state: GameState): number => {
  if (isGhostOf(agent)) {
    return 4
  }
  const member = memberOf(agent, state, false)
  if (member.state === 'waiting' || member.mood === 'hurt') {
    return 0
  }
  if (member.state === 'working') {
    return 1
  }
  return member.isDone || isFinished(workOf(agent, state)) ? 3 : 2
}

/** The team in the order the band fills its slots and the Panel lists its cards: the lead first. */
export const teamOrderOf = (state: GameState): GameAgent[] => {
  const ranked = state.agents.map((agent) => ({
    agent,
    rank: agent.isLeader ? -1 : rankOf(agent, state)
  }))
  // Why a stable sort: members with no activity time keep the host's order.
  return ranked
    .sort((a, b) => a.rank - b.rank || (b.agent.activeAt ?? 0) - (a.agent.activeAt ?? 0))
    .map((one) => one.agent)
}

/** The members the band leaves out because nobody can say what they are doing. */
export const ghostCountOf = (state: GameState): number =>
  state.agents.filter((agent) => !agent.isLeader && isGhostOf(agent)).length

// The lead is the HUD's hero, so the party is everyone else that is not a ghost.
export const partyOf = (state: GameState, hasRewards: boolean): PartyMember[] =>
  teamOrderOf(state)
    .filter((agent) => !agent.isLeader && !isGhostOf(agent))
    .map((agent) => memberOf(agent, state, hasRewards))

/** The party the band draws and how many ghosts its `+N` adds. */
export const drawnPartyOf = (
  state: GameState,
  hasRewards: boolean
): { party: PartyMember[]; unseen: number } => ({
  party: partyOf(state, hasRewards),
  unseen: ghostCountOf(state)
})

// Why (ORCA-907): a logged-out member's hooks say idle, but it waits on a person to log it in.
const needStateOf = (agent: GameAgent): GameAgent['state'] =>
  agent.limit?.loggedOut ? 'waiting' : agent.state

export const countsOf = (agents: readonly GameAgent[]) => {
  const team = agents.filter((agent) => !agent.isLeader)
  const count = (state: GameAgent['state']) =>
    team.filter((agent) => needStateOf(agent) === state).length
  return {
    working: count('working'),
    idle: count('idle'),
    waiting: count('waiting'),
    done: count('done')
  }
}

export const needsOf = (state: GameState): Need[] => {
  const { waitingNeed, ciFailingNeed } = gameStrings().text
  return [
    ...state.agents
      .filter((agent) => !agent.isLeader && needStateOf(agent) === 'waiting')
      .map((agent) => ({
        name: agent.displayName,
        text: agent.limit?.loggedOut ? limitTagOf(agent.limit, Date.now()) : waitingNeed,
        url: null
      })),
    ...(state.review !== null && isCiRed(state.review)
      ? [
          {
            name: reviewLabelOf(state.review),
            text: ciFailingNeed,
            url: linkOfKind(state.links, 'ci')?.url ?? state.review.url
          }
        ]
      : []),
    ...state.agents
      .filter((agent) => agent.worktree !== undefined && agent.review && isCiRed(agent.review))
      .map((agent) => ({
        name: agent.displayName,
        text: ciFailingNeed,
        url: agent.review?.url ?? null
      }))
  ]
}

// The lead wears the costume most of its party wears, and the King once all of it is done.
export const fleetPhaseOf = (
  members: readonly Pick<PartyMember, 'phase' | 'isDone'>[]
): FlowPhase | undefined => {
  if (members.length === 0) {
    return undefined
  }
  if (members.every((one) => one.isDone)) {
    return 'handoff'
  }
  const counts = new Map<ScenePhase, number>()
  for (const one of members.filter((member) => !member.isDone)) {
    counts.set(one.phase, (counts.get(one.phase) ?? 0) + 1)
  }
  const [top] = [...counts].sort(
    (a, b) => b[1] - a[1] || FLOW_ORDER.indexOf(b[0]) - FLOW_ORDER.indexOf(a[0])
  )
  return top === undefined || top[0] === 'working' ? undefined : top[0]
}
