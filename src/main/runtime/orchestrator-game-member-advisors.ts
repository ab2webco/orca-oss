import {
  GAME_MEMBER_ADVISOR_PANES_MAX,
  parseGameMemberAdvisorReport,
  type GameMemberAdvisor,
  type GameMemberAdvisorPick,
  type GameMemberAdvisorReport
} from '../../shared/orchestrator-game-member-advisor'

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

  /** True when the panel would now show something else for this pane. */
  note(paneKey: string, report: GameMemberAdvisorReport | null, now: number): boolean {
    const kept = this.of(paneKey, now)
    this.byPane.delete(paneKey)
    this.keeper?.write(paneKey, report)
    const changed = !isSameReport(kept, report)
    if (report === null) {
      return changed
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
    return changed
  }

  /** A pane's report as it came over the wire; one this build cannot read leaves the last. */
  noteReport(paneKey: string, raw: unknown, now: number): boolean {
    const report = parseGameMemberAdvisorReport(raw)
    return report !== undefined && this.note(paneKey, report, now)
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

  /** Only what the pane still reports. Why no kept copy: a section must not outlive its mod. */
  liveOf(paneKey: string, now: number): GameMemberAdvisor | null {
    const held = this.byPane.get(paneKey)
    return held && now - held.at < GAME_MEMBER_ADVISOR_TTL_MS ? held.advisor : null
  }

  // Why: a finished member stopped polling, so its last report is the model it still runs on.
  private keptOf(paneKey: string): GameMemberAdvisor | null {
    return this.keeper?.read(paneKey) ?? null
  }
}

// Why sorted keys: also orders `pinned`, whose keys repeat the top level's; `previous` is derived here.
const reportKeyOf = (report: GameMemberAdvisor | GameMemberAdvisorReport | null): string => {
  if (report === null) {
    return 'null'
  }
  const { previous: _previous, ...rest } = report as GameMemberAdvisor
  return JSON.stringify(rest, Object.keys(rest).sort())
}

const isSameReport = (
  kept: GameMemberAdvisor | null,
  report: GameMemberAdvisorReport | null
): boolean => reportKeyOf(kept) === reportKeyOf(report)

const pickOf = (advisor: GameMemberAdvisorPick): GameMemberAdvisorPick => ({
  model: advisor.model,
  effort: advisor.effort
})
