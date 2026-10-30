import type { EngineInterface } from 'claude-code'

import type { GameState } from '../types'
import { leadTitleOf } from './game-lead'
import { gameStrings } from './game-strings'
import { leadStateOf } from './lead-state'
import { marchesOf, MARCH_TICKS, type HdMember } from './hd-party'
import type { TeamEvent } from './hd-overlay'
import { partyOf } from './party'
import { quest } from './quest-state'

// What the scene learns from each refresh: the party it draws, who marched in or out, the crown, the
// lead's own state, and the team events (a reward, a teammate waiting, a merge, CI turning red) it acts out.

const memberOf = (one: Required<HdMember>) => ({
  key: one.key,
  name: one.name,
  phase: one.phase,
  state: one.state
})

/** The party, its marches and the lead's crown from a game state; the first state marches nobody. */
export function syncHdTeam(state: GameState, hasRewards: boolean): void {
  const party: HdMember[] = partyOf(state, hasRewards).map(memberOf)
  const keys = party.map((one) => one.key)
  const before = quest.hdParty
  if (quest.isHdPartySeen) {
    quest.marches = marchesOf(
      before.map((one) => one.key),
      keys,
      quest.marches,
      quest.tick
    )
  }
  const gone = before.filter((one) => !keys.includes(one.key))
  quest.leavers = [
    ...quest.leavers.filter(
      (one) =>
        !keys.includes(one.key) && quest.tick - (quest.marches.get(one.key)?.at ?? 0) < MARCH_TICKS
    ),
    ...(quest.isHdPartySeen ? gone : [])
  ]
  quest.hdParty = party
  quest.isHdPartySeen = true
  quest.lead = state.role === 'lead' ? leadTitleOf(state, gameStrings().art.lead) : undefined
  quest.leadState = state.role === 'lead' ? leadStateOf(state) : undefined
}

/** Plays a team event in the hd scene from this tick. */
export function raiseTeamEvent($: EngineInterface, kind: TeamEvent['kind'], text: string): void {
  quest.event = { kind, text, at: quest.tick }
  $.ui.invalidate('ui.render')
}
