import type { GameBoardCaller, GameBoardProject } from './orchestrator-game-board'
import type { GameHistoryStore } from './orchestrator-game-history-store'
import {
  awardGameTeamXp,
  teamXpOf,
  type GameTeamXp,
  type GameXpReward
} from '../../shared/orchestrator-game-team-xp'

/** The lead project's team XP: the mod reports each reward it toasts, the panel and band read it. */
export class GameTeamXpLedger {
  constructor(
    private readonly deps: {
      store: Pick<GameHistoryStore, 'changeDataField'>
      projectOf: (caller: GameBoardCaller) => Promise<GameBoardProject>
      now?: () => number
    }
  ) {}

  async read(caller: GameBoardCaller): Promise<GameTeamXp> {
    const { key } = await this.deps.projectOf(caller)
    return this.deps.store.changeDataField(key, 'teamXp', (raw, characters) => ({
      next: null,
      result: teamXpOf(raw, characters)
    }))
  }

  /** Why a member may award: its pane sees its own CI and ticket, under the ids its lead's would use. */
  async award(
    caller: GameBoardCaller,
    rewards: readonly GameXpReward[]
  ): Promise<{ added: number; teamXp: GameTeamXp }> {
    const { key } = await this.deps.projectOf(caller)
    const at = this.deps.now?.() ?? Date.now()
    return this.deps.store.changeDataField(key, 'teamXp', (raw, characters) => {
      const { next, added } = awardGameTeamXp(raw, characters, rewards, at)
      return { next, result: { added: added.length, teamXp: teamXpOf(next ?? raw, characters) } }
    })
  }
}
