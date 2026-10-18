import type { GameAgent, GameState } from '../types'
import type { HudMember } from './fleet-hud'
import { linkOfKind } from './fleet-labels'
import { gameStrings } from './game-strings'
import { leadStateOf } from './lead-state'
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

// The lead is the HUD's hero, so the party is everyone else.
export const partyOf = (state: GameState, hasRewards: boolean): PartyMember[] =>
  state.agents.filter((agent) => !agent.isLeader).map((agent) => memberOf(agent, state, hasRewards))

export const countsOf = (agents: readonly GameAgent[]) => {
  const team = agents.filter((agent) => !agent.isLeader)
  const count = (state: GameAgent['state']) => team.filter((agent) => agent.state === state).length
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
      .filter((agent) => !agent.isLeader && agent.state === 'waiting')
      .map((agent) => ({ name: agent.displayName, text: waitingNeed, url: null })),
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
