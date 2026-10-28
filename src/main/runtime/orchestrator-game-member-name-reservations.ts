import {
  memberNameOf,
  nextMemberName,
  type GameMemberName
} from '../../shared/orchestrator-game-member-names'
import type { GameMemberSession } from '../../shared/orchestrator-game-member-sessions'

type ScannedRow = { paneKey: string; parentPaneKey?: string | null; displayName?: string | null }
type ScannedWorktree = { worktreeId: string; repoId?: string; agents: readonly ScannedRow[] }

// Why 10 min: a member's row shows up only once its agent boots, so the hold must outlast that.
const HOLD_MS = 10 * 60_000

/**
 * Every name a live member of the project holds, whichever lead launched it: rows in the project's
 * worktrees, members its panes launched in other repos, saved members whose worktree still runs,
 * and members placed on paired hosts (their home task titles).
 */
export function liveProjectMemberNamesOf(args: {
  worktrees: readonly ScannedWorktree[]
  inProject: (worktree: ScannedWorktree) => boolean
  saved: readonly Pick<GameMemberSession, 'name' | 'worktreeId' | 'lastState'>[]
  remote?: readonly string[]
}): string[] {
  const projectPanes = new Set(
    args.worktrees.filter(args.inProject).flatMap((one) => one.agents.map((row) => row.paneKey))
  )
  const rows = args.worktrees.flatMap((one) =>
    args.inProject(one)
      ? one.agents
      : one.agents.filter((row) => row.parentPaneKey && projectPanes.has(row.parentPaneKey))
  )
  const running = new Set(
    args.worktrees.filter((one) => one.agents.length > 0).map((one) => one.worktreeId)
  )
  const saved = args.saved.filter(
    (one) => one.lastState !== 'finished' && one.worktreeId !== null && running.has(one.worktreeId)
  )
  return [
    ...rows.map((row) => row.displayName),
    ...saved.map((one) => one.name),
    ...(args.remote ?? [])
  ].flatMap((name) => memberNameOf(name) ?? [])
}

/** Names picked for launches whose members do not run yet, held per project so two launches never share one. */
export class GameMemberNameReservations {
  private readonly held = new Map<string, { ticket: string; name: string; until: number }[]>()

  constructor(private readonly now: () => number = Date.now) {}

  // Why synchronous: no await between reading the holds and adding one, so concurrent launches serialize here.
  reserve(args: {
    projectKey: string
    ticket: string
    roster: readonly GameMemberName[]
    locale: string
    taken: readonly string[]
  }): string | null {
    const now = this.now()
    const held = (this.held.get(args.projectKey) ?? []).filter(
      (one) => one.until > now && one.ticket !== args.ticket
    )
    const name = nextMemberName(
      args.roster,
      [...args.taken, ...held.map((one) => one.name)],
      args.locale
    )
    this.held.set(
      args.projectKey,
      name === null ? held : [...held, { ticket: args.ticket, name, until: now + HOLD_MS }]
    )
    return name
  }
}
