import {
  parseGameMemberAdvisorReport,
  type GameMemberAdvisor,
  type GameMemberAdvisorPick,
  type GameMemberAdvisorReport
} from '../../shared/orchestrator-game-member-advisor'

const GAME_MEMBER_ADVISOR_PANES_MAX = 64
// Why 3 minutes: a member polls every 30 s, so six missed reports mean its Jev or its mod is gone.
export const GAME_MEMBER_ADVISOR_TTL_MS = 3 * 60_000

type Held = { advisor: GameMemberAdvisor; at: number }

const isSamePick = (a: GameMemberAdvisorPick, b: GameMemberAdvisorPick): boolean =>
  a.model === b.model && a.effort === b.effort

/** A member's last report kept outside memory, so a finished or restarted member still shows its model. */
export type GameMemberAdvisorKeeper = {
  read(paneKey: string): GameMemberAdvisorReport | null
  write(paneKey: string, report: GameMemberAdvisorReport | null): void
}

/** Each member pane's Jev report, in memory and in the keeper: a restart refills it within one poll. */
export class GameMemberAdvisors {
  private readonly byPane = new Map<string, Held>()

  constructor(
    private readonly maxPanes = GAME_MEMBER_ADVISOR_PANES_MAX,
    private readonly keeper?: GameMemberAdvisorKeeper
  ) {}

  note(paneKey: string, report: GameMemberAdvisorReport | null, now: number): void {
    const kept = this.of(paneKey, now)
    this.byPane.delete(paneKey)
    this.keeper?.write(paneKey, report)
    if (report === null) {
      return
    }
    const previous =
      kept === null ? undefined : isSamePick(kept, report) ? kept.previous : pickOf(kept)
    this.byPane.set(paneKey, {
      advisor: { ...report, ...(previous ? { previous } : {}) },
      at: now
    })
    // Why: re-inserting keeps the Map in recency order, so the stalest pane is evicted first.
    for (const stale of this.byPane.keys()) {
      if (this.byPane.size <= this.maxPanes) {
        break
      }
      this.byPane.delete(stale)
    }
  }

  /** A pane's report as it came over the wire; one this build cannot read leaves the last. */
  noteReport(paneKey: string, raw: unknown, now: number): void {
    const report = parseGameMemberAdvisorReport(raw)
    if (report !== undefined) {
      this.note(paneKey, report, now)
    }
  }

  of(paneKey: string, now: number): GameMemberAdvisor | null {
    const held = this.byPane.get(paneKey)
    if (!held) {
      return this.keptOf(paneKey)
    }
    if (now - held.at >= GAME_MEMBER_ADVISOR_TTL_MS) {
      this.byPane.delete(paneKey)
      return this.keptOf(paneKey)
    }
    return held.advisor
  }

  // Why: a finished member stopped polling, so its last report is the model it still runs on.
  private keptOf(paneKey: string): GameMemberAdvisor | null {
    return this.keeper?.read(paneKey) ?? null
  }
}

const pickOf = (advisor: GameMemberAdvisorPick): GameMemberAdvisorPick => ({
  model: advisor.model,
  effort: advisor.effort
})
