import type { GameBoardCaller, GameBoardProject } from './orchestrator-game-board'
import type { GameHistoryStore } from './orchestrator-game-history-store'
import {
  applyGameArcadeAction,
  type GameArcadeAction,
  type GameArcadeCredits
} from '../../shared/orchestrator-game-arcade-credits'

/** The project's saved arcade plays: the host's board earns them, the person's panel spends them. */
export class GameArcadeLedger {
  constructor(
    private readonly deps: {
      store: Pick<GameHistoryStore, 'arcade' | 'changeArcade' | 'migrateArcadeOffers'>
      projectOf: (caller: GameBoardCaller) => Promise<GameBoardProject>
      /** Lets an open panel refresh instead of polling. */
      changed?: (projectKey: string) => void
    }
  ) {}

  /** Null for a member: credits belong to the lead's project, and only the lead's panel shows them. */
  async read(caller: GameBoardCaller): Promise<GameArcadeCredits | null> {
    const project = await this.deps.projectOf(caller)
    return project.isMember ? null : this.deps.store.arcade(project.key)
  }

  async apply(
    caller: GameBoardCaller,
    action: GameArcadeAction
  ): Promise<{ ok: boolean; arcade: GameArcadeCredits }> {
    const project = await this.deps.projectOf(caller)
    if (project.isMember) {
      throw new Error("Only the lead's project spends arcade credits.")
    }
    const outcome = await this.deps.store.changeArcade(project.key, (current) => {
      const applied = applyGameArcadeAction(current, action)
      return { next: applied.ok ? applied.next : null, result: applied }
    })
    if (outcome.ok) {
      this.deps.changed?.(project.key)
    }
    return { ok: outcome.ok, arcade: outcome.next }
  }

  /** The offers the terminal's old countdown kept, paid once into the lead's project. */
  async migrate(
    caller: GameBoardCaller,
    offers: readonly string[]
  ): Promise<{ ok: true; paid: number; arcade: GameArcadeCredits }> {
    const project = await this.deps.projectOf(caller)
    if (project.isMember) {
      throw new Error("Only the lead's project takes the terminal's kept offers.")
    }
    const outcome = await this.deps.store.migrateArcadeOffers(project.key, offers)
    if (outcome.paid > 0) {
      this.deps.changed?.(project.key)
    }
    return { ok: true, ...outcome }
  }
}
