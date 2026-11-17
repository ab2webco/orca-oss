import {
  parseGameMemberSteward,
  type GameMemberSteward
} from '../../shared/orchestrator-game-member-steward'
import { GAME_MEMBER_ADVISOR_PANES_MAX } from '../../shared/orchestrator-game-member-advisor'
import { GAME_MEMBER_ADVISOR_TTL_MS } from './orchestrator-game-member-advisors'

type Held = { steward: GameMemberSteward; at: number }

// Why stepsSeen is left out: it moves on every step, and a card does not draw it.
const keyOf = (steward: GameMemberSteward | null): string =>
  steward === null ? 'null' : JSON.stringify({ ...steward, stepsSeen: 0 })

/** Each member pane's steward report (ORCA-1242), dropped once the pane stops polling. */
export class GameMemberStewards {
  private readonly byPane = new Map<string, Held>()

  constructor(private readonly maxPanes = GAME_MEMBER_ADVISOR_PANES_MAX) {}

  /** The parsed report (null when none came); `changed` when a card would now draw something else. */
  noteReport(
    paneKey: string,
    raw: unknown,
    now: number
  ): { steward: GameMemberSteward | null; changed: boolean } {
    const steward = parseGameMemberSteward(raw)
    if (steward === undefined) {
      return { steward: null, changed: false }
    }
    const kept = this.of(paneKey, now)
    this.byPane.delete(paneKey)
    if (steward !== null) {
      this.byPane.set(paneKey, { steward, at: now })
    }
    for (const stale of this.byPane.keys()) {
      if (this.byPane.size <= this.maxPanes) {
        break
      }
      this.byPane.delete(stale)
    }
    return { steward, changed: keyOf(kept) !== keyOf(steward) }
  }

  of(paneKey: string, now: number): GameMemberSteward | null {
    const held = this.byPane.get(paneKey)
    if (held && now - held.at >= GAME_MEMBER_ADVISOR_TTL_MS) {
      this.byPane.delete(paneKey)
      return null
    }
    return held?.steward ?? null
  }
}
