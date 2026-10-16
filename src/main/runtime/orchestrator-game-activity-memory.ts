import type { GameActivity } from '../../shared/orchestrator-game-state'

const GAME_ACTIVITY_PANES_MAX = 64

/** Each pane's latest matched activity, so it outlives the few MCP calls the hook server keeps. */
export class GameActivityMemory {
  private readonly byPane = new Map<string, GameActivity>()

  constructor(private readonly maxPanes = GAME_ACTIVITY_PANES_MAX) {}

  /** The newer of `found` and what was remembered; a remembered one is no longer running. */
  recall(paneKey: string, found: GameActivity | null): GameActivity | null {
    const kept = this.byPane.get(paneKey)
    if (found && (!kept || found.at >= kept.at)) {
      // Why: re-inserting keeps the Map in recency order, so the stalest pane is evicted first.
      this.byPane.delete(paneKey)
      this.byPane.set(paneKey, found)
      for (const stale of this.byPane.keys()) {
        if (this.byPane.size <= this.maxPanes) {
          break
        }
        this.byPane.delete(stale)
      }
      return found
    }
    return kept ? { ...kept, running: false } : null
  }

  forget(paneKey: string): void {
    this.byPane.delete(paneKey)
  }
}
